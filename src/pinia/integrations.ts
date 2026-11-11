import { defineStore } from 'pinia';
import { ref, shallowReactive } from 'vue';
 import integrationCore from '@/extensions/integrations/index.js';
import { resolveConnection } from '@/_common/helpers/code/connnections.js';
import { buildIntegrationBindings } from '@/_common/helpers/code/integrationBindings';
 
export const NATIVE_INTEGRATIONS = ['ai-gateway', 'http-request', 'weweb-auth', 'weweb-storage', 'custom-auth'];
export const CODE_EXPOSED_INTEGRATIONS = ['supabase', 'xano'];

/** Why a resource cannot use its connection: it is not listed, or the project has no access to it yet. */
export type ConnectionIssue = 'missing' | 'no-project-access';

export const useIntegrationsStore = defineStore('integrations', () => {
    const installed = ref([...NATIVE_INTEGRATIONS]);
    /**
     * A project's own connection, or one of its workspace's: those the project has access to, and those the user may
     * give it access to (`projectHasAccess` false), which nothing uses until then.
     */
    type Connection = {
        id: string;
        name: string;
        integration: string;
        /**
         * `null` for a workspace connection the project has no access to that the user may not edit: its variables stay
         * out too.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each integration reads its own config
        config: any;
        isWorkspaceConnection?: boolean;
        projectHasAccess?: boolean;
        /**
         * A workspace connection's: whether the user may use it themselves, and so add it to the project or remove it.
         * Without it, they only use it in the project.
         */
        userHasAccess?: boolean;
        /** A workspace connection's: the user's permissions on it, `edit` revealing its secrets. */
        permissions?: string[];
    };
    const connections = ref<Record<string, Connection>>({});
    /* wwFront:start */
    // eslint-disable-next-line no-undef
    // @ts-expect-error {} is injected at build time by the weweb build process
    connections.value = {};
    /* wwFront:end */
    const instances = shallowReactive({});
    // Stable across config edits, scoped to this store; temporary environment instances do not
    // receive this identity because they must not replace the registered connection instance.
    const connectionInstanceScopes = new Map<string, { generation: number }>();
 
    /**
     * A workspace connection is only used once the project has access to it and installs its integration. A published
     * app only gets the connections its project uses.
     */
    function isUsable(connection: Connection) {
         return true;
    }

    function workspaceConnectionsOf(integration: string) {
        return Object.values(connections.value).filter(
            connection => connection.isWorkspaceConnection && connection.integration === integration
        );
    }

    async function initializeConnectionInstance(connectionId: string) {
        const rawConnection = connections.value[connectionId];
        if (!rawConnection || !isUsable(rawConnection)) return;

        const connection = resolveConnection(rawConnection);
        if (!connection) return;

        const integration = integrationCore[connection.integration];
        if (!integration?.connection?.init) return;

        try {
            if (!connectionInstanceScopes.has(connectionId))
                connectionInstanceScopes.set(connectionId, { generation: 0 });
            const instanceScope = connectionInstanceScopes.get(connectionId);
            const generation = ++instanceScope.generation;
            const instance = await integration.connection.init({
                connection,
                instanceScope,
            });
            if (instanceScope.generation !== generation) return;
            instances[connectionId] = instance;
        } catch (error) {
            wwLib.wwLog?.error('Failed to initialize connection instance', error);
        }
    }

 
    async function initializeIntegrationInstance(integrationKey: string) {
        const integration = integrationCore[integrationKey];
        if (!integration?.init) return;

        try {
            const instance = await integration.init();
            instances[integrationKey] = instance;
        } catch (error) {
            wwLib.wwLog?.error('Failed to initialize integration instance', error);
        }
    }

    async function initializeInstances() {
        for (const integrationKey of installed.value) {
            await initializeIntegrationInstance(integrationKey);
        }

        for (const connectionId in connections.value) {
            await initializeConnectionInstance(connectionId);
        }
    }

 
    function getCodeBindings() {
        const bindingSources = [];
        for (const connectionId in connections.value) {
            const connection = connections.value[connectionId];
            if (!CODE_EXPOSED_INTEGRATIONS.includes(connection.integration) || !isUsable(connection)) continue;
            const instance = instances[connectionId];
            if (!instance) continue;
            bindingSources.push({
                id: connectionId,
                name: connection.name,
                integration: connection.integration,
                instance,
            });
        }
        return buildIntegrationBindings(bindingSources, CODE_EXPOSED_INTEGRATIONS);
    }

    function getCodeExposedConnections() {
        return Object.values(connections.value).filter(
            connection =>
                CODE_EXPOSED_INTEGRATIONS.includes(connection.integration) &&
                isUsable(connection) &&
                instances[connection.id]
        );
    }

    return {
        installed,
        connections,
        getInstance(id: string) {
            return instances[id] || null;
        },
        getCodeBindings,
        getCodeExposedConnections,
        getConnection(connectionId: string, env: string = null) {
            if (!connectionId) return null;
            const connection = connections.value[connectionId];
            if (!connection || !isUsable(connection)) return null;
            return resolveConnection(connection, env);
        },
        initializeInstances,
        initializeConnectionInstance,
         addIntegration(integration: string) {
            if (!integration) return;
            if (!installed.value.includes(integration)) {
                installed.value.push(integration);
            }
        },
        removeIntegration(integration: string) {
            const index = installed.value.indexOf(integration);
            if (index !== -1) {
                installed.value.splice(index, 1);
            }

            if (instances[integration]) {
                delete instances[integration];
            }
            // The workspace keeps its connections: the project only stops using them.
            for (const connection of workspaceConnectionsOf(integration)) {
                if (instances[connection.id]) delete instances[connection.id];
            }
        },
        addConnection(connection: Connection) {
            if (!connection?.id) return;
            connections.value[connection.id] = connection;
        },
     };
});
