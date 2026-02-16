import { redisService } from './src/utils/redisClient'
import { pubSubService } from './src/utils/pubsub'
import { generateH3IndexesForRoute } from './src/rideMatching/demo'
import { dataSet } from './src/utils/sampleDataSet'
import express from 'express'
import findRideRouter from './src/routes/findRide'
import { rideWebSocketHandler, type WsData } from './src/routes/findRide'

const app = express()
app.use(express.json())

async function main() {
    await redisService.connect()
    await pubSubService.connect()

    // for(const item of dataSet) {
    //     const result = await generateH3IndexesForRoute(item)
    //     const res1 = await redisService.storeDestinationH3Index(item.name, result.destinationH3)
    //     const isMetaDataStored = await redisService.storePassengerMetaData(item.name, {
    //         no_of_passengers: item.no_of_passengers,
    //         destination_h3: result.destinationH3,
    //         luggage: item.luggage,
    //         status: 'WAITING',
    //         issued_price: 500//Calculate the price here
    //     })

    //     const res2 = await redisService.storeRouteH3Index(item.name, result.pathH3Indexes)
    // if(res2) {
    //     console.log("Route Indexes stored successfully");
    // }
    // }
}
main()

// ── HTTP Server (Express) on port 3000 ──
app.use('/find-ride', findRideRouter)

app.get('/', async (req, res) => {

})

app.listen(3000, () => {
    console.log('HTTP server running on http://localhost:3000')
})

// ── WebSocket Server (Bun native) on port 3001 ──
const wsServer = Bun.serve({
    port: 3001,
    fetch(req, server) {
        const url = new URL(req.url)

        if (url.pathname === '/ws') {
            const userId = url.searchParams.get('userId')

            if (!userId) {
                return new Response(
                    JSON.stringify({ error: 'Missing userId query parameter' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                )
            }

            const upgraded = server.upgrade(req, {
                data: { userId } as WsData
            })

            if (upgraded) return undefined

            return new Response('WebSocket upgrade failed', { status: 500 })
        }

        return new Response('WebSocket server — connect to /ws?userId=<id>', { status: 200 })
    },
    websocket: rideWebSocketHandler,
})

console.log(`WebSocket server running on ws://localhost:${wsServer.port}/ws`)

// ── Graceful Shutdown ──
const shutdown = async () => {
    console.log('\nShutting down gracefully...')
    await pubSubService.disconnect()
    await redisService.disconnect()
    wsServer.stop()
    process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
