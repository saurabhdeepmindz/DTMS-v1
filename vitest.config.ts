import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Jobs integration tests share the fixed schema through one disposable PostgREST database.
        fileParallelism: !process.env.JOBS_TEST_DATABASE_URL,
        exclude: ['**/node_modules/**'],
    },
});
