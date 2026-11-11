import { describe, expect, it } from 'vitest';
import { promisePool } from './promisePool';

function wait(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('promisePool', () => {
    it('preserves result order', async () => {
        const results = await promisePool(
            [1, 2, 3, 4],
            async item => {
                await wait((5 - item) * 2);
                return item * 2;
            },
            2
        );

        expect(results).toEqual([2, 4, 6, 8]);
    });

    it('limits concurrent work', async () => {
        let activeCount = 0;
        let maxActiveCount = 0;

        await promisePool(
            [1, 2, 3, 4, 5, 6, 7, 8],
            async item => {
                activeCount += 1;
                maxActiveCount = Math.max(maxActiveCount, activeCount);
                await wait();
                activeCount -= 1;
                return item;
            },
            4
        );

        expect(maxActiveCount).toBe(4);
    });

    it('does not call the mapper for empty inputs', async () => {
        let callCount = 0;

        const results = await promisePool(
            [],
            async item => {
                callCount += 1;
                return item;
            },
            4
        );

        expect(results).toEqual([]);
        expect(callCount).toBe(0);
    });

    it('rejects invalid concurrency values', async () => {
        await expect(promisePool([1], async item => item, 0)).rejects.toThrow(
            'promisePool concurrency must be a positive integer'
        );
        await expect(promisePool([1], async item => item, 1.5)).rejects.toThrow(
            'promisePool concurrency must be a positive integer'
        );
    });

    it('propagates mapper errors', async () => {
        await expect(
            promisePool(
                [1, 2, 3],
                async item => {
                    if (item === 2) throw new Error('failed');
                    return item;
                },
                2
            )
        ).rejects.toThrow('failed');
    });
});
