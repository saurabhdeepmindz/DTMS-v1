import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/services/database/formulaV2QueryBuilder.postgres.test.ts'],
        fileParallelism: false,
        hookTimeout: 15_000,
        testTimeout: 15_000,
    },
});
