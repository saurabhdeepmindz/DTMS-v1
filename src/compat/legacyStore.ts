import { toRaw, unref, type App } from 'vue';

export interface LegacyDomain {
    store: Record<string, any>;
    getters: Record<string, string | { index: string }>;
    actions: Record<string, string>;
    mutations: Record<string, string | ((payload: any) => unknown)>;
}

/** The supported component API, backed by the same Pinia objects as native consumers. */
export function createLegacyStore(domains: Record<string, LegacyDomain>) {
    const state: Record<string, any> = {};
    const getters: Record<string, any> = {};
    const namespaces: Record<string, any> = {};
    const commits = new Map<string, (payload: any) => unknown>();
    const actions = new Map<string, (payload: any) => unknown>();

    function normalize(type: string | { type: string }, payload?: unknown) {
        return typeof type === 'string' ? { type, payload } : { type: type.type, payload: type };
    }
    function commit(type: string | { type: string }, payload?: unknown) {
        const operation = normalize(type, payload);
        const handler = commits.get(operation.type);
        if (!handler) {
            console.error(`[WeWeb compatibility] Unknown mutation: ${operation.type}`);
            return;
        }
        handler(operation.payload);
    }
    function dispatch(type: string | { type: string }, payload?: unknown) {
        const operation = normalize(type, payload);
        const handler = actions.get(operation.type);
        if (!handler) {
            console.error(`[WeWeb compatibility] Unknown action: ${operation.type}`);
            return;
        }
        try {
            return Promise.resolve(handler(operation.payload));
        } catch (error) {
            return Promise.reject(error);
        }
    }

    for (const [namespace, domain] of Object.entries(domains)) {
        const store = domain.store;
        const rawStore = toRaw(store);
        Object.defineProperty(state, namespace, { enumerable: true, get: () => store.$state });
        const localGetters = {};
        for (const [name, nativePath] of Object.entries(domain.getters)) {
            if (typeof nativePath !== 'string') {
                // Historical function getters keep their callable contract over live native indexes.
                const lookup = (key: string) => unref(rawStore[nativePath.index])[key];
                const read = () => lookup;
                Object.defineProperty(getters, `${namespace}/${name}`, { enumerable: true, get: read });
                Object.defineProperty(localGetters, name, { enumerable: true, get: read });
                continue;
            }
            // Retain the live Pinia ref, not its value. Avoid an extra reactive store
            // proxy on every read made by an already-compiled component.
            const [property, ...path] = nativePath.split('.');
            const read = path.length
                ? () => path.reduce((value, key) => value[key], unref(rawStore[property]))
                : () => unref(rawStore[property]);
            Object.defineProperty(getters, `${namespace}/${name}`, { enumerable: true, get: read });
            Object.defineProperty(localGetters, name, { enumerable: true, get: read });
        }
        for (const [name, method] of Object.entries(domain.mutations))
            commits.set(`${namespace}/${name}`, typeof method === 'string' ? store[method] : method);
        for (const [name, method] of Object.entries(domain.actions)) actions.set(`${namespace}/${name}`, store[method]);
        const local =
            (operation: typeof commit | typeof dispatch) =>
            (type: string | { type: string }, payload?: any, options?: { root?: boolean }) => {
                if (typeof type === 'object' && type !== null) {
                    options = payload;
                    payload = type;
                    type = type.type;
                }
                return operation(options?.root ? type : `${namespace}/${type}`, payload);
            };
        // Vuex's already-compiled, namespaced map* helpers read this context.
        const context = { getters: localGetters, commit: local(commit), dispatch: local(dispatch) };
        Object.defineProperty(context, 'state', { enumerable: true, get: () => store.$state });
        namespaces[`${namespace}/`] = { context };
    }

    const facade = {
        state,
        getters,
        commit,
        dispatch,
        _modulesNamespaceMap: namespaces,
        install(app: App) {
            app.provide('store', facade);
            app.config.globalProperties.$store = facade;
        },
    };
    return facade;
}
