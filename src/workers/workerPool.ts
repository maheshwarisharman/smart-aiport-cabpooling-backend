import { cpus } from 'os'

/**
 * WorkerPool — manages a pool of Bun Worker threads for CPU-intensive tasks.
 *
 * Tasks are distributed round-robin across workers. Each task gets a unique ID
 * so the correct Promise is resolved when the worker responds.
 *
 * Usage:
 *   const pool = new WorkerPool('./path/to/worker.ts', 4)
 *   await pool.init()
 *   const result = await pool.execute({ type: 'MATCH', payload: { ... } })
 */

interface PendingTask<T = unknown> {
    resolve: (value: T) => void
    reject: (reason: unknown) => void
}

export class WorkerPool {
    private workers: Worker[] = []
    private pendingTasks: Map<string, PendingTask> = new Map()
    private nextWorkerIndex: number = 0
    private taskIdCounter: number = 0
    private readonly workerPath: string
    private readonly poolSize: number
    private isReady: boolean = false

    constructor(workerPath: string, poolSize?: number) {
        this.workerPath = workerPath
        // Default: use half the available CPUs (leave room for main thread + I/O)
        // Minimum 2 workers, maximum 6 (diminishing returns beyond that)
        const cpuCount = cpus().length
        this.poolSize = poolSize ?? Math.min(Math.max(2, Math.floor(cpuCount / 2)), 6)
    }

    /**
     * Initialize the worker pool. Creates all worker threads and waits
     * for each one to signal readiness.
     */
    async init(): Promise<void> {
        if (this.isReady) return

        const readyPromises: Promise<void>[] = []

        for (let i = 0; i < this.poolSize; i++) {
            const worker = new Worker(this.workerPath, { smol: true })
            const workerId = i

            // Wait for each worker to send a READY message
            const readyPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Worker ${workerId} failed to initialize within 10s`))
                }, 10_000)

                const onReady = (event: MessageEvent) => {
                    if (event.data?.type === 'READY') {
                        clearTimeout(timeout)
                        worker.removeEventListener('message', onReady)
                        resolve()
                    }
                }
                worker.addEventListener('message', onReady)
            })

            // Handle ongoing messages (task results)
            worker.addEventListener('message', (event: MessageEvent) => {
                const { taskId, result, error } = event.data

                if (!taskId) return // Ignore non-task messages (like READY)

                const pending = this.pendingTasks.get(taskId)
                if (!pending) return

                this.pendingTasks.delete(taskId)

                if (error) {
                    pending.reject(new Error(error))
                } else {
                    pending.resolve(result)
                }
            })

            // Handle worker errors
            worker.addEventListener('error', (event) => {
                console.error(`[WorkerPool] Worker ${workerId} error:`, event)
            })

            this.workers.push(worker)
            readyPromises.push(readyPromise)
        }

        await Promise.all(readyPromises)
        this.isReady = true
        console.log(`[WorkerPool] Initialized ${this.poolSize} worker threads`)
    }

    /**
     * Execute a task on the next available worker (round-robin).
     * Returns a promise that resolves with the worker's result.
     */
    execute<TResult = unknown>(payload: Record<string, unknown>): Promise<TResult> {
        if (!this.isReady) {
            throw new Error('[WorkerPool] Pool not initialized. Call init() first.')
        }

        const taskId = `task_${++this.taskIdCounter}_${Date.now()}`

        return new Promise<TResult>((resolve, reject) => {
            this.pendingTasks.set(taskId, { resolve: resolve as (value: unknown) => void, reject })

            // Round-robin worker selection
            const worker = this.workers[this.nextWorkerIndex]!
            this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.poolSize

            worker.postMessage({ taskId, ...payload })
        })
    }

    /**
     * Get the number of currently pending tasks across all workers.
     */
    get pendingCount(): number {
        return this.pendingTasks.size
    }

    /**
     * Get the pool size (number of worker threads).
     */
    get size(): number {
        return this.poolSize
    }

    /**
     * Gracefully terminate all workers.
     */
    async terminate(): Promise<void> {
        // Reject any pending tasks
        for (const [taskId, pending] of this.pendingTasks) {
            pending.reject(new Error('Worker pool terminated'))
        }
        this.pendingTasks.clear()

        // Terminate all workers
        for (const worker of this.workers) {
            worker.terminate()
        }
        this.workers = []
        this.isReady = false
        console.log('[WorkerPool] All workers terminated')
    }
}
