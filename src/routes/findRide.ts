import { Router } from 'express';
import { generateH3IndexesForRoute } from '../rideMatching/demo';
import { redisService } from '../utils/redisClient';
import { pubSubService } from '../utils/pubsub';
import type { ServerWebSocket } from 'bun';

const router = Router();

export interface WsData {
    userId: string;
}


export const rideWebSocketHandler = {
    async open(ws: ServerWebSocket<WsData>) {
        const { userId } = ws.data;
        if (!userId) {
            ws.send(JSON.stringify({ error: 'Missing userId query parameter' }));
            ws.close(1008, 'Missing userId');
            return;
        }

        await pubSubService.subscribe(userId, (message: string) => {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(message);
            }
        });

        ws.send(JSON.stringify({
            type: 'CONNECTED',
            message: `Listening for ride matches for user: ${userId}`
        }));

        console.log(`WebSocket opened for user: ${userId}`);
    },

    async message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        // Client can send a ping/heartbeat; echo back a pong
        try {
            const data = JSON.parse(message.toString());
            if (data.type === 'PING') {
                ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            }
        } catch {
            // Ignore malformed messages
        }
    },

    async close(ws: ServerWebSocket<WsData>, code: number, reason: string) {
        const { userId } = ws.data;
        if (userId) {
            await pubSubService.unsubscribe(userId);
            console.log(`WebSocket closed for user: ${userId} (code: ${code})`);
        }
    },
};

const userDestination = {
    "latitude": 28.625819,
    "longitude": 77.208977,
    "name": "Bangla Sahib2"
}

interface FindRideRequest {
    no_of_passengers: number;
    luggage: number;
}

router.post('/', async (req, res) => {
    try {
        const body = req.body as FindRideRequest;
        const result = await generateH3IndexesForRoute(userDestination)


        // Store metadata
        const isMetaDataStored = await redisService.storePassengerMetaData(userDestination.name, {
            no_of_passengers: body.no_of_passengers,
            destination_h3: result.destinationH3,
            luggage: body.luggage,
            status: 'WAITING',
            issued_price: 500 //Calculate the price here
        })

        // Store route index
        const res2 = await redisService.storeRouteH3Index(userDestination.name, result.pathH3Indexes)
        if (res2) {
            console.log("Route Indexes stored successfully");
        }

        console.log(body)

        const matches = await redisService.matchUserWithAvaialbleTrip(userDestination.name, result.pathH3Indexes, {
            no_of_passengers: body.no_of_passengers,
            destination_h3: result.destinationH3,
            luggage: body.luggage,
            status: 'WAITING',
            issued_price: 500 //Calculate the price here
        })

        console.log(matches)
        res.json(matches)
    } catch (error) {
        console.error("Error in find-ride:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
})

export default router;
