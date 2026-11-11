type PrerenderTerminationCoordinatorOptions = {
    terminateActiveProcesses: () => void;
    warn: (error: unknown) => void;
};

type PrerenderCompletionOptions = {
    accountUnprocessedRoutes: () => void;
    finalize: () => Promise<void>;
};

/**
 * Separates synchronous signal cancellation from asynchronous campaign completion.
 * Signals may stop active children, but only the campaign owner may account routes,
 * persist the final report, and remove temporary files after its active await settles.
 */
export function createPrerenderTerminationCoordinator({
    terminateActiveProcesses,
    warn,
}: PrerenderTerminationCoordinatorOptions) {
    let requested = false;

    return {
        isRequested(): boolean {
            return requested;
        },
        request(): void {
            if (requested) return;
            requested = true;
            try {
                terminateActiveProcesses();
            } catch (error) {
                warn(error);
            }
        },
        async complete({ accountUnprocessedRoutes, finalize }: PrerenderCompletionOptions): Promise<boolean> {
            if (requested) accountUnprocessedRoutes();
            await finalize();
            return requested;
        },
    };
}
