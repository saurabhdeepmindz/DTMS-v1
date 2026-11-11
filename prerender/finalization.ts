import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrerenderReport } from './report.ts';

type PrerenderFinalizerOptions = {
    clientManifestPath: string;
    report: PrerenderReport;
    reportPath: string;
    workPath: string;
    terminateProcesses: () => void;
    logResourceUsage: () => void;
};

/**
 * Creates one completion boundary shared by normal completion, failures, and signals.
 * The client-only manifest is removed before other asynchronous finalization so it can
 * never be included in the directory Publisher uploads after this process exits.
 */
export function createPrerenderFinalizer({
    clientManifestPath,
    report,
    reportPath,
    workPath,
    terminateProcesses,
    logResourceUsage,
}: PrerenderFinalizerOptions): () => Promise<void> {
    let finalization: Promise<void> | undefined;

    return () => {
        if (finalization) return finalization;

        finalization = (async () => {
            try {
                terminateProcesses();
            } catch (error) {
                warn('unable to terminate pre-rendering processes', error);
            }

            await removePath(clientManifestPath, false, 'unable to remove the client build manifest');

            try {
                logResourceUsage();
            } catch (error) {
                warn('unable to log final pre-rendering resource usage', error);
            }

            try {
                await fs.mkdir(path.dirname(reportPath), { recursive: true });
                await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
            } catch (error) {
                warn('unable to write the pre-rendering report', error);
            }

            await removePath(workPath, true, 'unable to remove pre-rendering temporary files');
        })();

        return finalization;
    };
}

async function removePath(targetPath: string, recursive: boolean, warning: string): Promise<void> {
    try {
        await fs.rm(targetPath, { recursive, force: true });
    } catch (error) {
        warn(warning, error);
    }
}

function warn(message: string, error: unknown): void {
    console.warn(`[weweb-prerender] ${message}`, {
        message: error instanceof Error ? error.message : `${error}`,
    });
}
