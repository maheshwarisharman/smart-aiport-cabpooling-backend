import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// ── Constants ──
const OTP_EXPIRY_MINUTES = 5;

/**
 * Generate a cryptographically-adequate random 6-digit OTP.
 * Range: 100_000 – 999_999 (always 6 digits).
 */
function generateOtp(): number {
    return Math.floor(100_000 + Math.random() * 900_000);
}

// ──────────────────────────────────────────────────────────────
// POST /generate-otp
// Body: { trip_id: string }
//
// Generates a unique OTP for every user associated with the
// given trip (via RideRequests) and stores it — along with an
// expiry timestamp — on each Users row.
// ──────────────────────────────────────────────────────────────
router.post('/generate-otp', async (req, res) => {
    try {
        const { trip_id } = req.body;

        // ── Validate input ──
        if (!trip_id || typeof trip_id !== 'string') {
            res.status(400).json({ error: 'trip_id is required and must be a string' });
            return;
        }

        // ── Fetch trip along with its ride requests & users ──
        const trip = await prisma.trips.findUnique({
            where: { id: trip_id },
            include: {
                rideRequests: {
                    include: { user: true }
                }
            }
        });

        if (!trip) {
            res.status(404).json({ error: 'Trip not found' });
            return;
        }

        // ── Guard: Trip must still be in a "WAITING" (or similar pre-active) state ──
        if (trip.status === 'ACTIVE') {
            res.status(409).json({ error: 'Trip is already active' });
            return;
        }

        if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
            res.status(409).json({ error: `Trip is already ${trip.status.toLowerCase()}` });
            return;
        }

        // ── Guard: Trip must have at least one ride request ──
        if (trip.rideRequests.length === 0) {
            res.status(422).json({ error: 'Trip has no ride requests / users' });
            return;
        }

        // ── Generate OTPs and update each user atomically ──
        const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

        const otpUpdates = trip.rideRequests.map((rr) => {
            const otp = generateOtp();
            return {
                user_id: rr.user_id,
                user_name: rr.user.name,
                otp,
                update: prisma.users.update({
                    where: { id: rr.user_id },
                    data: {
                        ride_otp: otp,
                        otp_expiry: otpExpiry,
                    },
                }),
            };
        });

        // Execute all updates inside a single transaction
        await prisma.$transaction(otpUpdates.map((u) => u.update));

        // Build a response that shows which users received OTPs
        // (In production you would NOT expose the OTPs directly — you'd
        //  send them via SMS/Push. Returning them here for dev convenience.)
        const otpSummary = otpUpdates.map((u) => ({
            user_id: u.user_id,
            user_name: u.user_name,
            otp: u.otp,
            otp_expiry: otpExpiry.toISOString(),
        }));

        res.status(200).json({
            message: 'OTPs generated successfully',
            trip_id,
            otp_expiry: otpExpiry.toISOString(),
        });
    } catch (error) {
        console.error('Error generating OTPs:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /start
// Body: {
//   trip_id: string,
//   verifications: [{ user_id: string, otp: number }, ...]
// }
//
// Verifies each user's OTP against the database. If ALL OTPs
// are valid and not expired:
//   a) Clears ride_otp & otp_expiry on every user
//   b) Sets the Trip status to "ACTIVE"
//   c) Sets every RideRequest in the trip to "ACTIVE"
// ──────────────────────────────────────────────────────────────
interface OtpVerification {
    user_id: string;
    otp: number;
}

router.post('/start', async (req, res) => {
    try {
        const { trip_id, verifications } = req.body as {
            trip_id?: string;
            verifications?: OtpVerification[];
        };

        // ── Validate input ──
        if (!trip_id || typeof trip_id !== 'string') {
            res.status(400).json({ error: 'trip_id is required and must be a string' });
            return;
        }

        if (!Array.isArray(verifications) || verifications.length === 0) {
            res.status(400).json({ error: 'verifications must be a non-empty array of { user_id, otp }' });
            return;
        }

        // Validate individual entries
        for (const v of verifications) {
            if (!v.user_id || typeof v.user_id !== 'string') {
                res.status(400).json({ error: `Each verification must include a valid user_id (string)` });
                return;
            }
            if (v.otp == null || typeof v.otp !== 'number') {
                res.status(400).json({ error: `Each verification must include a valid otp (number) — user_id: ${v.user_id}` });
                return;
            }
        }

        // ── Check for duplicate user_ids in the payload ──
        const userIdSet = new Set(verifications.map((v) => v.user_id));
        if (userIdSet.size !== verifications.length) {
            res.status(400).json({ error: 'Duplicate user_id entries found in verifications' });
            return;
        }

        // ── Fetch trip with all ride requests ──
        const trip = await prisma.trips.findUnique({
            where: { id: trip_id },
            include: {
                rideRequests: true,
            },
        });

        if (!trip) {
            res.status(404).json({ error: 'Trip not found' });
            return;
        }

        if (trip.status === 'ACTIVE') {
            res.status(409).json({ error: 'Trip is already active' });
            return;
        }

        if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
            res.status(409).json({ error: `Trip is already ${trip.status.toLowerCase()}` });
            return;
        }

        // ── Ensure all users in the trip are accounted for ──
        const tripUserIds = new Set(trip.rideRequests.map((rr) => rr.user_id));

        const missingUsers = [...tripUserIds].filter((uid) => !userIdSet.has(uid));
        if (missingUsers.length > 0) {
            res.status(400).json({
                error: 'OTP verification is missing for some users in this trip',
                missing_user_ids: missingUsers,
            });
            return;
        }

        const extraUsers = verifications.filter((v) => !tripUserIds.has(v.user_id));
        if (extraUsers.length > 0) {
            res.status(400).json({
                error: 'Some user_ids in verifications do not belong to this trip',
                extra_user_ids: extraUsers.map((v) => v.user_id),
            });
            return;
        }

        // ── Fetch all users and verify OTPs ──
        const users = await prisma.users.findMany({
            where: { id: { in: verifications.map((v) => v.user_id) } },
            select: { id: true, ride_otp: true, otp_expiry: true },
        });

        const userMap = new Map(users.map((u) => [u.id, u]));
        const failedVerifications: { user_id: string; reason: string }[] = [];

        const now = new Date();

        for (const v of verifications) {
            const user = userMap.get(v.user_id);

            if (!user) {
                failedVerifications.push({ user_id: v.user_id, reason: 'User not found' });
                continue;
            }

            if (user.ride_otp == null) {
                failedVerifications.push({ user_id: v.user_id, reason: 'No OTP has been generated for this user' });
                continue;
            }

            if (user.otp_expiry && user.otp_expiry < now) {
                failedVerifications.push({ user_id: v.user_id, reason: 'OTP has expired' });
                continue;
            }

            if (user.ride_otp !== v.otp) {
                failedVerifications.push({ user_id: v.user_id, reason: 'Invalid OTP' });
                continue;
            }
        }

        if (failedVerifications.length > 0) {
            res.status(401).json({
                error: 'OTP verification failed for one or more users',
                failed: failedVerifications,
            });
            return;
        }

        // ── All OTPs verified — execute state changes atomically ──
        const rideRequestIds = trip.rideRequests.map((rr) => rr.id);
        const userIds = verifications.map((v) => v.user_id);

        await prisma.$transaction([
            // a) Clear OTP fields for all users in this trip
            prisma.users.updateMany({
                where: { id: { in: userIds } },
                data: {
                    ride_otp: null,
                    otp_expiry: null,
                },
            }),

            // b) Set Trip status to ACTIVE
            prisma.trips.update({
                where: { id: trip_id },
                data: { status: 'ACTIVE' },
            }),

            // c) Set all related RideRequests to ACTIVE
            prisma.rideRequests.updateMany({
                where: { id: { in: rideRequestIds } },
                data: { status: 'ACTIVE' },
            }),
        ]);

        res.status(200).json({
            message: 'Ride started successfully',
            trip_id,
            status: 'ACTIVE',
            activated_users: userIds,
            activated_ride_requests: rideRequestIds,
        });
    } catch (error) {
        console.error('Error starting ride:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ──────────────────────────────────────────────────────────────
// POST /get-otp
// Body: { user_id: string }
//
// Returns the current OTP for the given user, if one has been
// generated and has not yet expired.
// ──────────────────────────────────────────────────────────────
router.post('/get-otp', async (req, res) => {
    try {
        const { user_id } = req.body;

        // ── Validate input ──
        if (!user_id || typeof user_id !== 'string') {
            res.status(400).json({ error: 'user_id is required and must be a string' });
            return;
        }

        // ── Fetch user ──
        const user = await prisma.users.findUnique({
            where: { id: user_id },
            select: { id: true, ride_otp: true, otp_expiry: true },
        });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        // ── Check if OTP exists ──
        if (user.ride_otp == null) {
            res.status(404).json({ error: 'No OTP has been generated for this user' });
            return;
        }

        // ── Check if OTP has expired ──
        if (user.otp_expiry && user.otp_expiry < new Date()) {
            res.status(410).json({ error: 'OTP has expired. Please request a new one.' });
            return;
        }

        res.status(200).json({ otp: user.ride_otp });
    } catch (error) {
        console.error('Error fetching OTP:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
