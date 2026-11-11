interface CacheItem<T> {
    data: T;
    timestamp: number;
}

export class AsyncCache<T = any> {
    private cache: Map<string, CacheItem<T>>;
    private TTL: number;
    private pendingPromises: Map<string, Promise<T>>;

    constructor(ttlMs: number = 60000) {
        // Default 1 minute TTL
        this.cache = new Map();
        this.TTL = ttlMs;
        this.pendingPromises = new Map();
    }

    async get(key: string, fetchFn: () => Promise<T>): Promise<T> {
        // Check if there's already a pending promise for this key
        if (this.pendingPromises.has(key)) {
            return this.pendingPromises.get(key)!;
        }

        const cachedItem = this.cache.get(key);
        if (cachedItem && !this._isExpired(cachedItem.timestamp)) {
            return cachedItem.data;
        }

        // If we reach here, we need to fetch new data
        try {
            // Create a new promise for this fetch operation
            const promise = fetchFn();
            this.pendingPromises.set(key, promise);

            // Wait for the fetch to complete
            const data = await promise;

            // Store in cache with current timestamp
            this.cache.set(key, {
                data,
                timestamp: Date.now(),
            });

            return data;
        } finally {
            // Clean up the pending promise
            this.pendingPromises.delete(key);
        }
    }

    private _isExpired(timestamp: number): boolean {
        return Date.now() - timestamp > this.TTL;
    }

    invalidate(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }
}
