import { Router } from 'express';
import { generateH3IndexesForRoute } from '../rideMatching/demo';
import { redisService } from '../utils/redisClient';
import { pubSubService } from '../utils/pubsub';
import { prisma } from '../../lib/prisma';
import type { ServerWebSocket } from 'bun';

const router = Router();

// ── Get all trips for a user ──
router.post('/trips', async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            res.status(400).json({ error: 'user_id is required' });
            return;
        }

        const trips = await prisma.rideRequests.findMany({
            where: { user_id },
            include: {
                trip: {
                    include: {
                        cab: {
                            include: {
                                driver: true
                            }
                        },
                        rideRequests: {
                            include: {
                                user: true
                            }
                        }
                    }
                }
            }
        });

        res.json({ trips });
    } catch (error) {
        console.error('Error fetching trips:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export interface WsData {
    userId: string;
}

interface RegisterRidePayload {
    type: 'REGISTER_RIDE';
    no_of_passengers: number;
    luggage: number;
    latitude: number;
    longitude: number;
}

export const rideWebSocketHandler = {
    async open(ws: ServerWebSocket<WsData>) {
        const { userId } = ws.data;
        if (!userId) {
            ws.send(JSON.stringify({ error: 'Missing userId query parameter' }));
            ws.close(1008, 'Missing userId');
            return;
        }

        // ── Step 1: Check if user already has a WAITING trip in the DB ──
        const existingWaitingTrip = await prisma.rideRequests.findFirst({
            where: {
                user_id: userId,
                status: 'WAITING'
            },
            include: { trip: true }
        });

        // Subscribe to PubSub for match notifications regardless
        await pubSubService.subscribe(userId, (message: string) => {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            }
        });

        if (existingWaitingTrip) {
            // User already has a WAITING trip in DB — they are part of a trip
            // that is waiting for more riders. No need to re-insert into Redis.
            ws.send(JSON.stringify({
                type: 'CONNECTED',
                status: 'EXISTING_TRIP',
                message: `Reconnected — already part of waiting trip: ${existingWaitingTrip.trip_id}`,
                trip_id: existingWaitingTrip
            }));
        } else {
            // No existing WAITING trip — user must send a REGISTER_RIDE message
            // with their ride details so we can re-insert them into the Redis pool.
            ws.send(JSON.stringify({
                type: 'CONNECTED',
                status: 'AWAITING_REGISTRATION',
                message: `Connected. Send a REGISTER_RIDE message with your ride details to enter the matching pool.`
            }));
        }

        console.log(`WebSocket opened for user: ${userId}`);
    },

    async message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'PING') {
                ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
                return;
            }

            // ── Handle REGISTER_RIDE — re-insert user into Redis pool ──
            if (data.type === 'REGISTER_RIDE') {
                const { userId } = ws.data;
                const payload = data as RegisterRidePayload;

                // Validate required fields
                if (!payload.no_of_passengers || payload.luggage == null || !payload.latitude || !payload.longitude) {
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        message: 'REGISTER_RIDE requires: no_of_passengers, luggage, latitude, longitude'
                    }));
                    return;
                }

                try {
                    // Generate H3 indexes for the route
                    const result = await generateH3IndexesForRoute({
                        latitude: payload.latitude,
                        longitude: payload.longitude
                    });

                    const userMetaData = {
                        no_of_passengers: payload.no_of_passengers,
                        destination_h3: result.destinationH3,
                        luggage: payload.luggage,
                        status: 'WAITING' as const,
                        issued_price: 500 // TODO: Calculate the price here
                    };

                    // Store metadata in Redis
                    await redisService.storePassengerMetaData(userId, userMetaData);

                    // Store route index in Redis sorted set
                    await redisService.storeRouteH3Index(userId, result.pathH3Indexes);

                    // Attempt matching immediately
                    const matches = await redisService.matchUserWithAvaialbleTrip(
                        userId,
                        result.pathH3Indexes,
                        userMetaData
                    );

                    if (matches.match_type !== 'NONE') {
                        // Match found! Notify via WebSocket
                        ws.send(JSON.stringify({
                            type: 'RIDE_MATCHED',
                            ...matches
                        }));
                    } else {
                        // No match yet — user stays in the Redis pool,
                        // waiting for a future HTTP request or WS user to match with them
                        ws.send(JSON.stringify({
                            type: 'REGISTERED',
                            message: 'You are now in the matching pool. Waiting for a ride match...'
                        }));
                    }
                } catch (err) {
                    console.error(`[WS] Error processing REGISTER_RIDE for ${userId}:`, err);
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        message: 'Failed to register ride. Please try again.'
                    }));
                }
                return;
            }
        } catch {
            // Ignore malformed messages
        }
    },

    async close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
        const { userId } = ws.data;
        if (userId) {
            // ── Remove user from Redis pool on disconnect ──
            // This ensures no one can match with a disconnected user
            await redisService.removeUserFromPool(userId);
            await pubSubService.unsubscribe(userId);
            console.log(`WebSocket closed for user: ${userId} (code: ${code}) — removed from Redis pool`);
        }
    },
};

const userDestination = {
    "latitude": 28.625819,
    "longitude": 77.208977,
    "name": "Bangla Sahib3"
}

interface FindRideRequest {
    no_of_passengers: number;
    luggage: number;
    user_id: string
    latitude: number,
    longitude: number,
}

// router.post('/', async (req, res) => {
//     try {
//         const body = req.body as FindRideRequest;
//         const result = await generateH3IndexesForRoute(body)

//         // Store metadata
//         await redisService.storePassengerMetaData(body.user_id, {
//             no_of_passengers: body.no_of_passengers,
//             destination_h3: result.destinationH3,
//             luggage: body.luggage,
//             status: 'WAITING',
//             issued_price: 500 //TODO:Calculate the price here
//         })

//         // Store route index
//         await redisService.storeRouteH3Index(body.user_id, result.pathH3Indexes)

//         const matches = await redisService.matchUserWithAvaialbleTrip(body.user_id, result.pathH3Indexes, {
//             no_of_passengers: body.no_of_passengers,
//             destination_h3: result.destinationH3,
//             luggage: body.luggage,
//             status: 'WAITING',
//             issued_price: 500 //Calculate the price here
//         })

//         // ── If no match found, clean up Redis immediately ──
//         // The user's data should NOT linger in Redis from the HTTP request.
//         // If the user is interested, they will connect via WebSocket and
//         // re-register, which puts them back in the pool.
//         if (matches.match_type === 'NONE') {
//             await redisService.removeUserFromPool(body.user_id);
//             console.log(`[find-ride] No match for ${body.user_id} — cleaned up Redis entries`);
//         }

//         res.json(matches)
//     } catch (error) {
//         console.error("Error in find-ride:", error);
//         res.status(500).json({ error: "Internal Server Error" });
//     }
// })

export default router;
