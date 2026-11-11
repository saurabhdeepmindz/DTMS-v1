import fs from 'node:fs/promises';
import path from 'node:path';

export type PrerenderAttemptFiles = {
    routeFile: string;
    resultFile: string;
};

type PrerenderAttemptOptions = {
    workPath: string;
    routeIndex: number;
    attempt: number;
    input: unknown;
};

/**
 * Owns the complete lifecycle of one route-render attempt's disk artifacts.
 *
 * The callback may return or throw. Cleanup is best-effort and never replaces the
 * callback's primary result or error.
 */
export async function withPrerenderAttemptFiles<T>(
    { workPath, routeIndex, attempt, input }: PrerenderAttemptOptions,
    callback: (files: PrerenderAttemptFiles) => Promise<T>
): Promise<T> {
    const routeFile = path.join(workPath, `${routeIndex}-${attempt}-route.json`);
    const resultFile = path.join(workPath, `${routeIndex}-${attempt}-render.json`);
    await fs.writeFile(routeFile, JSON.stringify(input), 'utf8');

    try {
        return await callback({ routeFile, resultFile });
    } finally {
        await cleanupAttemptFiles([routeFile, resultFile]);
    }
}

async function cleanupAttemptFiles(files: string[]): Promise<void> {
    const cleanupResults = await Promise.allSettled(files.map(file => fs.rm(file, { force: true })));

    for (let index = 0; index < cleanupResults.length; index++) {
        const result = cleanupResults[index];
        if (result.status === 'fulfilled') continue;

        console.warn('[weweb-prerender] unable to remove a route-render artifact', {
            file: path.basename(files[index]),
            message: getErrorMessage(result.reason),
        });
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : `${error}`;
}
