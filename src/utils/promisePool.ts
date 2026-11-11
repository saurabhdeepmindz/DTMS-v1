export async function promisePool<T, R>(
    items: readonly T[],
    mapper: (item: T, index: number) => R,
    concurrency: number
): Promise<Awaited<R>[]> {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error('promisePool concurrency must be a positive integer');
    }

    if (!items.length) return [];

    const results = new Array<Awaited<R>>(items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = (await mapper(items[currentIndex], currentIndex)) as Awaited<R>;
        }
    }

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}
