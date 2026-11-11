type PluginRuntimeInitializer = () => void | Promise<void>;

type PendingInitializer = {
    initialize: PluginRuntimeInitializer;
    resolve: () => void;
    reject: (error: unknown) => void;
};

export type PluginLifecycleScheduler = {
    register: (initialize: PluginRuntimeInitializer) => Promise<void>;
    activate: () => Promise<void>;
};

/**
 * Separates synchronous plugin registration from runtime-only initialization.
 * Static rendering can therefore expose plugin metadata without running onLoad,
 * while traditional clients retain eager activation and hydration activates only
 * after Vue owns the server-rendered DOM.
 */
export function createPluginLifecycleScheduler(): PluginLifecycleScheduler {
    let activated = false;
    let activationPromise: Promise<void> | undefined;
    const pendingInitializers: PendingInitializer[] = [];

    const run = async ({ initialize, resolve, reject }: PendingInitializer) => {
        try {
            await initialize();
            resolve();
        } catch (error) {
            reject(error);
        }
    };

    return {
        register(initialize) {
            const initialization = new Promise<void>((resolve, reject) => {
                const pendingInitializer = { initialize, resolve, reject };
                if (activated) {
                    void run(pendingInitializer);
                    return;
                }
                pendingInitializers.push(pendingInitializer);
            });

            return initialization;
        },
        activate() {
            if (activationPromise) return activationPromise;

            activated = true;
            activationPromise = Promise.all(pendingInitializers.splice(0).map(run)).then(() => undefined);
            return activationPromise;
        },
    };
}

export const pluginLifecycleScheduler = createPluginLifecycleScheduler();
