import { createClient, type RedisClientType } from 'redis';

type MatchCallback = (data: string) => void;


export class RedisPubSubService {
    private static instance: RedisPubSubService;

    private publisher: RedisClientType;
    private subscriber: RedisClientType;
    private callbacks: Map<string, MatchCallback> = new Map();
    private isConnected: boolean = false;

    private readonly CHANNEL_PREFIX = 'ride:match:';

    private constructor() {
        this.publisher = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
        this.subscriber = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

        this.publisher.on('error', (err) => console.error('Redis PubSub Publisher Error:', err));
        this.subscriber.on('error', (err) => console.error('Redis PubSub Subscriber Error:', err));
    }

    static getInstance(): RedisPubSubService {
        if (!RedisPubSubService.instance) {
            RedisPubSubService.instance = new RedisPubSubService();
        }
        return RedisPubSubService.instance;
    }

    async connect(): Promise<void> {
        if (this.isConnected) return;

        await Promise.all([
            this.publisher.connect(),
            this.subscriber.connect()
        ]);
        this.isConnected = true;
        console.log('Redis PubSub service connected');
    }

    async disconnect(): Promise<void> {
        if (!this.isConnected) return;

        // Unsubscribe from all active channels before disconnecting
        const unsubPromises = Array.from(this.callbacks.keys()).map(
            (userId) => this.unsubscribe(userId)
        );
        await Promise.all(unsubPromises);

        await Promise.all([
            this.publisher.quit(),
            this.subscriber.quit()
        ]);
        this.isConnected = false;
        this.callbacks.clear();
        console.log('Redis PubSub service disconnected');
    }

    /**
     * Subscribe to ride match notifications for a specific user.
     * Each user can have one active subscription at a time.
     */
    async subscribe(userId: string, callback: MatchCallback): Promise<void> {
        const channel = `${this.CHANNEL_PREFIX}${userId}`;

        // If already subscribed, unsubscribe first to avoid duplicates
        if (this.callbacks.has(userId)) {
            await this.unsubscribe(userId);
        }

        this.callbacks.set(userId, callback);

        await this.subscriber.subscribe(channel, (message) => {
            const cb = this.callbacks.get(userId);
            if (cb) {
                cb(message);
            }
        });

        console.log(`Subscribed to channel: ${channel}`);
    }

    /**
     * Unsubscribe a user from ride match notifications.
     */
    async unsubscribe(userId: string): Promise<void> {
        const channel = `${this.CHANNEL_PREFIX}${userId}`;

        try {
            await this.subscriber.unsubscribe(channel);
        } catch (err) {
            // Ignore errors from unsubscribing channels that aren't subscribed
            console.warn(`Warning unsubscribing from ${channel}:`, err);
        }

        this.callbacks.delete(userId);
        console.log(`Unsubscribed from channel: ${channel}`);
    }

    /**
     * Publish trip match data to a specific user's channel.
     * Returns the number of subscribers that received the message.
     */
    async publish(userId: string, data: unknown): Promise<number> {
        const channel = `${this.CHANNEL_PREFIX}${userId}`;
        const message = JSON.stringify(data);

        const receiverCount = await this.publisher.publish(channel, message);
        console.log(`Published to ${channel} — ${receiverCount} receiver(s)`);
        return receiverCount;
    }

    /**
     * Check if a user currently has an active subscription.
     */
    hasSubscription(userId: string): boolean {
        return this.callbacks.has(userId);
    }
}

export const pubSubService = RedisPubSubService.getInstance();
