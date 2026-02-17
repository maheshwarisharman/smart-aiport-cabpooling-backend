/**
 * rideMatchingWorker.ts
 *
 * Bun Worker thread that handles CPU-intensive ride matching logic.
 * Each worker thread has its own Redis + Prisma connections to avoid
 * contention on the main thread.
 *
 * Receives tasks via postMessage and returns results via postMessage.
 */

import { RedisPoolingService } from '../utils/redisCaching'
import { pubSubService } from '../utils/pubsub'

// ── Per-worker Redis connection ──
const workerRedisService = new RedisPoolingService()

// Track initialization state
let isInitialized = false

async function initialize(): Promise<void> {
    if (isInitialized) return
    await workerRedisService.connect()
    // Each worker thread has its own PubSub singleton — must connect it
    // so that publish() calls inside redisCaching.ts have a live connection
    await pubSubService.connect()
    isInitialized = true
    console.log(`[Worker ${process.pid}] Initialized — Redis + PubSub connected`)
}

// ── Worker message handler ──
declare var self: Worker

self.onmessage = async (event: MessageEvent) => {
    const { taskId, type, payload } = event.data

    // Ensure connections are ready
    if (!isInitialized) {
        await initialize()
    }

    try {
        switch (type) {
            case 'MATCH_RIDE': {
                const { userId, routeIndexes, userMetaData } = payload

                // Store metadata in Redis
                await workerRedisService.storePassengerMetaData(userId, userMetaData)

                // Store route index in Redis sorted set
                await workerRedisService.storeRouteH3Index(userId, routeIndexes)

                // Perform the CPU-intensive matching
                const result = await workerRedisService.matchUserWithAvaialbleTrip(
                    userId,
                    routeIndexes,
                    userMetaData
                )

                postMessage({ taskId, result })
                break
            }

            case 'REMOVE_USER': {
                const { userId } = payload
                await workerRedisService.removeUserFromPool(userId)
                postMessage({ taskId, result: { success: true } })
                break
            }

            case 'REMOVE_USER_FROM_TRIP': {
                const { userId } = payload
                await workerRedisService.removeUserFromTripMetadata(userId)
                postMessage({ taskId, result: { success: true } })
                break
            }

            default:
                postMessage({ taskId, error: `Unknown task type: ${type}` })
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`[Worker ${process.pid}] Task ${taskId} failed:`, errorMessage)
        postMessage({ taskId, error: errorMessage })
    }
}

// ── Signal readiness after initialization ──
initialize()
    .then(() => {
        postMessage({ type: 'READY' })
    })
    .catch((err) => {
        console.error(`[Worker] Failed to initialize:`, err)
        postMessage({ type: 'READY_ERROR', error: String(err) })
    })
