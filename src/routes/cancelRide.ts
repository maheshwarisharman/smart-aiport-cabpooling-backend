import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { pubSubService } from '../utils/pubsub';
import { rideMatchingPool } from '../../index';

const router = Router();

// ──────────────────────────────────────────────────────────────
// POST /cancel
// Body: { user_id: string, trip_id: string }
//
// Cancels a user's participation in a trip. Three scenarios:
//
// 1. Solo rider (1 RideRequest)
//    → Delete RideRequest, mark Trip as CANCELLED.
//
// 2. Exactly 2 riders
//    → Delete cancelling user's RideRequest, mark Trip CANCELLED,
//      cancel remaining user's RideRequest, notify them via PubSub.
//
// 3. 3+ riders
//    → Delete cancelling user's RideRequest, update Trip totals,
//      notify all remaining riders via PubSub.
//
// All DB writes are wrapped in a Prisma interactive transaction.
// Redis / PubSub failures are logged but do NOT roll back the DB.
// ──────────────────────────────────────────────────────────────
router.post('/cancel', async (req, res) => {
    try {
        const { user_id, trip_id } = req.body;

        // ── Input validation ──
        if (!user_id || typeof user_id !== 'string') {
            res.status(400).json({ error: 'user_id is required and must be a string' });
            return;
        }

        if (!trip_id || typeof trip_id !== 'string') {
            res.status(400).json({ error: 'trip_id is required and must be a string' });
            return;
        }

        // ── Fetch trip with all ride requests and user details ──
        const trip = await prisma.trips.findUnique({
            where: { id: trip_id },

            include: {
                rideRequests: {
                    include: {
                        user: {
                            select: { id: true, name: true, age: true, gender: true }
                        }
                    }
                }
            }
        });

        if (!trip) {
            res.status(404).json({ error: 'Trip not found' });
            return;
        }

        // ── Guard: Trip status ──
        if (trip.status === 'ACTIVE') {
            res.status(409).json({ error: 'Cannot cancel an active ride. The ride is already in progress.' });
            return;
        }

        if (trip.status === 'COMPLETED') {
            res.status(409).json({ error: 'Trip is already completed' });
            return;
        }

        if (trip.status === 'CANCELLED') {
            res.status(409).json({ error: 'Trip is already cancelled' });
            return;
        }

        // ── Guard: User must be part of this trip ──
        const cancellingRideRequest = trip.rideRequests.find(rr => rr.user_id === user_id);

        if (!cancellingRideRequest) {
            res.status(404).json({ error: 'User is not part of this trip' });
            return;
        }

        const totalRiders = trip.rideRequests.length;
        const remainingRideRequests = trip.rideRequests.filter(rr => rr.user_id !== user_id);

        // ────────────────────────────────────────────────────────
        // SCENARIO 1: Solo rider — simple cancellation
        // ────────────────────────────────────────────────────────
        if (totalRiders === 1) {
            await prisma.$transaction([
                prisma.rideRequests.delete({
                    where: { id: cancellingRideRequest.id }
                }),
                prisma.trips.update({
                    where: { id: trip_id },
                    data: { status: 'CANCELLED' }
                })
            ]);

            // Clean up Redis via worker thread (non-blocking)
            rideMatchingPool.execute({
                type: 'REMOVE_USER',
                payload: { userId: user_id }
            }).catch(err =>
                console.error(`[Cancel] Redis cleanup failed for user ${user_id}:`, err)
            );

            res.status(200).json({
                message: 'Trip cancelled successfully',
                trip_id,
                scenario: 'SOLO_CANCELLATION'
            });
            return;
        }

        // ────────────────────────────────────────────────────────
        // SCENARIO 2: Exactly 2 riders — trip becomes non-viable
        // Delete cancelling user's RideRequest, cancel the trip
        // and the remaining user's RideRequest entirely.
        // ────────────────────────────────────────────────────────
        if (totalRiders === 2) {
            const remainingUser = remainingRideRequests[0];

            await prisma.$transaction([
                // Delete the cancelling user's RideRequest
                prisma.rideRequests.delete({
                    where: { id: cancellingRideRequest.id }
                }),
                // Cancel the remaining user's RideRequest
                prisma.rideRequests.update({
                    where: { id: remainingUser.id },
                    data: { status: 'CANCELLED' }
                }),
                // Cancel the Trip
                prisma.trips.update({
                    where: { id: trip_id },
                    data: { status: 'CANCELLED' }
                }),
                // Release the cab back to AVAILABLE if one was assigned
                ...(trip.cab_id
                    ? [prisma.cabs.update({
                        where: { id: trip.cab_id },
                        data: { status: 'AVAILABLE' }
                    })]
                    : []
                )
            ]);

            // ── Redis cleanup via worker threads (non-blocking) ──
            Promise.all([
                rideMatchingPool.execute({ type: 'REMOVE_USER', payload: { userId: user_id } }),
                rideMatchingPool.execute({ type: 'REMOVE_USER', payload: { userId: remainingUser.user_id } })
            ]).catch(err =>
                console.error(`[Cancel] Redis cleanup failed for 2-rider scenario:`, err)
            );

            // ── Notify the remaining user via PubSub ──
            pubSubService.publish(remainingUser.user_id, {
                type: 'RIDE_CANCELLED',
                message: 'Your co-rider has cancelled. The trip has been cancelled.',
                trip_id,
                cancelled_by: user_id
            }).catch(err =>
                console.error(`[Cancel] PubSub notification failed for user ${remainingUser.user_id}:`, err)
            );

            // ── Unsubscribe both users from PubSub channels ──
            Promise.all([
                pubSubService.unsubscribe(user_id),
                pubSubService.unsubscribe(remainingUser.user_id)
            ]).catch(err =>
                console.error(`[Cancel] PubSub unsubscribe failed:`, err)
            );

            res.status(200).json({
                message: 'Trip cancelled — only one rider remained, trip is no longer viable',
                trip_id,
                scenario: 'TRIP_CANCELLED',
                notified_user: remainingUser.user_id
            });
            return;
        }

        // ────────────────────────────────────────────────────────
        // SCENARIO 3: 3+ riders — remove the user, trip continues
        // Update Trip totals and notify remaining riders.
        // ────────────────────────────────────────────────────────
        const updatedPassengerCount = trip.no_of_passengers - cancellingRideRequest.no_of_passengers;
        const updatedLuggage = trip.total_luggage - cancellingRideRequest.luggage_capacity;

        await prisma.$transaction([
            // Delete the cancelling user's RideRequest
            prisma.rideRequests.delete({
                where: { id: cancellingRideRequest.id }
            }),
            // Update Trip aggregate totals
            prisma.trips.update({
                where: { id: trip_id },
                data: {
                    no_of_passengers: Math.max(0, updatedPassengerCount),
                    total_luggage: Math.max(0, updatedLuggage)
                }
            })
        ]);

        // ── Redis cleanup: remove user from pool and trip metadata via worker thread ──
        rideMatchingPool.execute({
            type: 'REMOVE_USER_FROM_TRIP',
            payload: { userId: user_id }
        }).catch(err =>
            console.error(`[Cancel] Redis trip metadata cleanup failed for user ${user_id}:`, err)
        );

        // ── Fetch the updated trip to send in notifications ──
        const updatedTrip = await prisma.trips.findUnique({
            where: { id: trip_id },
            include: {
                cab: { include: { driver: true } },
                rideRequests: {
                    include: {
                        user: {
                            select: { name: true, age: true, gender: true }
                        }
                    }
                }
            }
        });

        // ── Notify all remaining riders via PubSub ──
        const notificationPromises = remainingRideRequests.map(rr =>
            pubSubService.publish(rr.user_id, {
                type: 'RIDER_LEFT',
                message: 'A co-rider has left the trip.',
                trip_id,
                cancelled_user_id: user_id,
                updated_trip: updatedTrip
            }).catch(err =>
                console.error(`[Cancel] PubSub notification failed for user ${rr.user_id}:`, err)
            )
        );
        await Promise.allSettled(notificationPromises);

        // ── Unsubscribe cancelled user from PubSub ──
        pubSubService.unsubscribe(user_id).catch(err =>
            console.error(`[Cancel] PubSub unsubscribe failed for user ${user_id}:`, err)
        );

        res.status(200).json({
            message: 'Successfully left the trip',
            trip_id,
            scenario: 'RIDER_REMOVED',
            remaining_riders: remainingRideRequests.length,
            notified_users: remainingRideRequests.map(rr => rr.user_id)
        });

    } catch (error) {
        console.error('Error cancelling ride:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
