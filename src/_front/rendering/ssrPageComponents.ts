import type { App, Component } from 'vue';

import {
    captureClientIslandError,
    createClientIslandBaseId,
    isKnownClientIsland,
    registerClientIsland,
    type ClientIslandType,
} from './clientIslandContext';

type SsrPageComponentLoader = {
    baseId: string;
    load: () => Promise<{ default: Component }>;
    name: string;
    type: ClientIslandType;
};

const MAX_CONCURRENT_COMPONENT_LOADS = 4;
const clientIslandPlaceholder: Component = {
    name: 'wwClientIslandPlaceholder',
    render: () => null,
};

export async function registerSsrPageComponents(app: App, loaders: SsrPageComponentLoader[]): Promise<void> {
    const componentBasesStore = wwLib.store.componentBases;
    const serverLoaders: SsrPageComponentLoader[] = [];

    for (const loader of loaders) {
        const clientIslandId = createClientIslandBaseId(loader.type, loader.baseId);
        const explicitlyClientOnly = componentBasesStore.configurations[loader.name]?.staticRendering === false;
        if (explicitlyClientOnly || isKnownClientIsland(clientIslandId)) {
            if (explicitlyClientOnly) registerClientIsland(clientIslandId);
            app.component(loader.name, clientIslandPlaceholder);
            continue;
        }
        serverLoaders.push(loader);
    }

    let nextLoaderIndex = 0;
    const loadNext = async (): Promise<void> => {
        while (nextLoaderIndex < serverLoaders.length) {
            const loader = serverLoaders[nextLoaderIndex++];
            try {
                const loadedModule = await loader.load();
                if (!loadedModule.default) throw new Error(`Component module ${loader.name} has no default export.`);
                app.component(loader.name, loadedModule.default);
            } catch (error) {
                captureClientIslandError(createClientIslandBaseId(loader.type, loader.baseId), error, {
                    category: 'component-module-load-error',
                    componentName: loader.name,
                    phase: 'component-module-load',
                });
                app.component(loader.name, clientIslandPlaceholder);
            }
        }
    };

    const workers: Promise<void>[] = [];
    const workerCount = Math.min(MAX_CONCURRENT_COMPONENT_LOADS, serverLoaders.length);
    for (let index = 0; index < workerCount; index++) workers.push(loadNext());
    await Promise.all(workers);
}
