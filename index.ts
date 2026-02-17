import { pubSubService } from './src/utils/pubsub'
import { WorkerPool } from './src/workers/workerPool'
import express from 'express'
import findRideRouter from './src/routes/findRide'
import { rideWebSocketHandler, type WsData } from './src/routes/findRide'
import signupRouter from './src/routes/signup'
import startRideRouter from './src/routes/startRide'
import cancelRideRouter from './src/routes/cancelRide'

const app = express()
app.use(express.json())

// ── Worker Pool (globally accessible) ──
const workerPath = new URL('./src/workers/rideMatchingWorker.ts', import.meta.url).href
export const rideMatchingPool = new WorkerPool(workerPath)

async function main() {
    // 1. Connect PubSub on the main thread
    //    (used for WebSocket subscription management)
    await pubSubService.connect()

    // 2. Initialize the worker pool
    //    Each worker gets its own Redis connection in its thread
    await rideMatchingPool.init()

    console.log(`\n🚀 Server started with ${rideMatchingPool.size} worker threads for ride matching`)
    console.log(`   CPU-intensive ride matching is offloaded to worker threads`)
    console.log(`   Main thread handles HTTP, WebSocket, and PubSub only\n`)
}
main()

// ── HTTP Server (Express) on port 3000 ──
app.use('/find-ride', findRideRouter)
app.use('/signup', signupRouter)
app.use('/ride', startRideRouter)
app.use('/cancel-ride', cancelRideRouter)

app.get('/', async (req, res) => {
    res.json({
        status: 'ok',
        workers: rideMatchingPool.size,
        pendingTasks: rideMatchingPool.pendingCount
    })
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
    await rideMatchingPool.terminate()
    await pubSubService.disconnect()
    wsServer.stop()
    process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
