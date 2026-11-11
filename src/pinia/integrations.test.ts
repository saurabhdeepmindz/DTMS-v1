import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { createPinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    initializeConnection: vi.fn(),
    giveProjectWorkspaceConnectionAccess: vi.fn(),
    removeProjectWorkspaceConnectionAccess: vi.fn(),
}));

vi.mock('@/extensions/integrations/index.js', () => ({
    default: {
        supabase: {
            connection: {
                init: mocks.initializeConnection,
            },
        },
    },
}));

vi.mock('@/_common/helpers/code/connnections.js', () => ({
    resolveConnection: vi.fn(connection => connection),
}));

vi.mock('@/_manager/integrations/index.js', () => ({ default: {} }));

vi.mock('@/_manager/backend/integrations.service.js', () => ({
    addIntegrationToProject: vi.fn(),
    deleteIntegrationFromProject: vi.fn(),
    createIntegrationConnection: vi.fn(),
    updateIntegrationConnection: vi.fn(),
    deleteIntegrationConnection: vi.fn(),
    giveProjectWorkspaceConnectionAccess: mocks.giveProjectWorkspaceConnectionAccess,
    removeProjectWorkspaceConnectionAccess: mocks.removeProjectWorkspaceConnectionAccess,
}));

describe('useIntegrationsStore', () => {
    beforeEach(() => {
        mocks.initializeConnection.mockReset();
        mocks.giveProjectWorkspaceConnectionAccess.mockReset();
        mocks.removeProjectWorkspaceConnectionAccess.mockReset();
        vi.stubGlobal('__WW_STORE_FRONT_CONNECTIONS__', {});
        vi.stubGlobal('wwLib', withStoreRegistry({
            wwLog: { error: vi.fn() },
        }));
    });

    it('reactively exposes a connection after its instance initializes', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        wwLib.$pinia = pinia;
        const { useIntegrationsStore } = await import('./integrations.js');
        const integrationsStore = useIntegrationsStore(pinia);
        const instance = { client: 'supabase' };
        mocks.initializeConnection.mockResolvedValue(instance);

        integrationsStore.addConnection({
            id: 'connection-id',
            name: 'Supabase',
            integration: 'supabase',
            config: {},
        });
        const exposedConnections = computed(() => integrationsStore.getCodeExposedConnections());
        expect(exposedConnections.value).toEqual([]);

        await integrationsStore.initializeConnectionInstance('connection-id');

        expect(exposedConnections.value).toEqual([
            { id: 'connection-id', name: 'Supabase', integration: 'supabase', config: {} },
        ]);
        expect(integrationsStore.getInstance('connection-id')).toBe(instance);
    });

    it('provides a stable scope for replacements, separate from other connections and previews', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        wwLib.$pinia = pinia;
        const { useIntegrationsStore } = await import('./integrations.js');
        const store = useIntegrationsStore(pinia);
        mocks.initializeConnection.mockResolvedValue({});
        for (const id of ['first', 'second']) {
            store.addConnection({ id, name: id, integration: 'supabase', config: {} });
        }
        await store.initializeConnectionInstance('first');
        const firstScope = mocks.initializeConnection.mock.calls.at(-1)[0].instanceScope;
        expect(firstScope).toBeTypeOf('object');
        // Updating config replaces the connection object; the instance scope must remain stable.
        store.addConnection({ id: 'first', name: 'updated', integration: 'supabase', config: { updated: true } });
        await store.initializeConnectionInstance('first');
        expect(mocks.initializeConnection.mock.calls.at(-1)[0].instanceScope).toBe(firstScope);
        await store.initializeConnectionInstance('second');
        expect(mocks.initializeConnection.mock.calls.at(-1)[0].instanceScope).not.toBe(firstScope);
        await store.buildConnectionInstanceForEnv('first', 'production');
        expect(mocks.initializeConnection.mock.calls.at(-1)[0].instanceScope).toBeUndefined();

        const otherStore = useIntegrationsStore(createPinia());
        otherStore.addConnection({ id: 'first', name: 'another project', integration: 'supabase', config: {} });
        await otherStore.initializeConnectionInstance('first');
        expect(mocks.initializeConnection.mock.calls.at(-1)[0].instanceScope).not.toBe(firstScope);
    });

    it('does not register an older initialization that finishes after its replacement', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        wwLib.$pinia = pinia;
        const { useIntegrationsStore } = await import('./integrations.js');
        const store = useIntegrationsStore(pinia);
        store.addConnection({ id: 'connection-id', name: 'test', integration: 'supabase', config: {} });
        let finishPrevious: (instance: object) => void;
        mocks.initializeConnection.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishPrevious = resolve;
                })
        );
        const previous = store.initializeConnectionInstance('connection-id');
        const replacement = { client: 'replacement' };
        mocks.initializeConnection.mockResolvedValueOnce(replacement);
        await store.initializeConnectionInstance('connection-id');
        finishPrevious({ client: 'retired' });
        await previous;
        expect(store.getInstance('connection-id')).toBe(replacement);
    });

    it('only uses a workspace connection once the project has access to it, the user giving it', async () => {
        const pinia = createPinia();
        // The store reads the project's variables through wwLib.store: the same pinia as the one read below.
        withStoreRegistry({ wwLog: { error: vi.fn() } }, pinia);
        const { useIntegrationsStore } = await import('./integrations.js');
        const store = useIntegrationsStore(pinia);
        mocks.initializeConnection.mockResolvedValue({ client: 'supabase' });
        const workspaceConnection = {
            id: 'workspace-id',
            name: 'Shared',
            integration: 'supabase',
            config: {},
            isWorkspaceConnection: true,
        };
        store.addIntegration('supabase');
        // Listed without its config, nor its variables, to a user who may not edit it.
        store.addConnection({ ...workspaceConnection, config: null, projectHasAccess: false });

        await store.initializeInstances();
        expect(store.getInstance('workspace-id')).toBeNull();
        expect(store.getConnection('workspace-id')).toBeNull();
        expect(store.getCodeExposedConnections()).toEqual([]);
        expect(store.getConnectionIssue('workspace-id')).toBe('no-project-access');
        expect(store.getConnectionIssue('deleted-id')).toBe('missing');
        expect(store.isConnectionUsable('workspace-id')).toBe(false);

        const envVariable = {
            id: 'variable-id',
            name: 'WORKSPACE_SUPABASE_KEY',
            editorValue: 'key',
            secure: false,
            connectionId: 'workspace-id',
            workspaceId: 'workspace',
        };
        mocks.giveProjectWorkspaceConnectionAccess.mockResolvedValue({
            connection: { ...workspaceConnection, projectHasAccess: true },
            envVariables: [envVariable],
        });
        const { useEnvVariablesStore } = await import('./envVariables.js');
        let variableAtInit: unknown;
        mocks.initializeConnection.mockImplementation(async () => {
            variableAtInit = (useEnvVariablesStore(pinia).values as Record<string, unknown>).WORKSPACE_SUPABASE_KEY;
            return { client: 'supabase' };
        });
        await store.giveProjectConnectionAccess('workspace-id');

        expect(mocks.giveProjectWorkspaceConnectionAccess).toHaveBeenCalledWith('workspace-id');
        expect(store.getConnectionIssue('workspace-id')).toBeNull();
        expect(store.connections['workspace-id'].config).toEqual({});
        // Its variables come with it, in time for its instance.
        expect(variableAtInit).toEqual(envVariable);
        expect(store.getInstance('workspace-id')).toEqual({ client: 'supabase' });
    });

    it('stops using a workspace connection once the user removes it from the project, which they may add back', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        wwLib.$pinia = pinia;
        const { useIntegrationsStore } = await import('./integrations.js');
        const store = useIntegrationsStore(pinia);
        mocks.initializeConnection.mockResolvedValue({ client: 'supabase' });
        const workspaceConnection = {
            id: 'workspace-id',
            name: 'Shared',
            integration: 'supabase',
            config: {},
            isWorkspaceConnection: true,
            userHasAccess: true,
        };
        store.addIntegration('supabase');
        store.addConnection({ ...workspaceConnection, projectHasAccess: true });
        await store.initializeInstances();
        expect(store.getInstance('workspace-id')).toEqual({ client: 'supabase' });

        mocks.removeProjectWorkspaceConnectionAccess.mockResolvedValue({
            connection: { ...workspaceConnection, projectHasAccess: false },
        });
        await store.removeProjectConnectionAccess('workspace-id');

        expect(mocks.removeProjectWorkspaceConnectionAccess).toHaveBeenCalledWith('workspace-id');
        expect(store.getInstance('workspace-id')).toBeNull();
        expect(store.getConnection('workspace-id')).toBeNull();
        expect(store.getConnectionIssue('workspace-id')).toBe('no-project-access');
    });

    it('offers no connection of an integration the project has not installed', async () => {
        const pinia = createPinia();
        setActivePinia(pinia);
        wwLib.$pinia = pinia;
        const { useIntegrationsStore } = await import('./integrations.js');
        const store = useIntegrationsStore(pinia);
        store.addConnection({
            id: 'workspace-id',
            name: 'Shared',
            integration: 'supabase',
            config: {},
            isWorkspaceConnection: true,
            projectHasAccess: true,
        });

        expect(store.selectableConnectionsOf('supabase')).toEqual([]);
        expect(store.isConnectionUsable('workspace-id')).toBe(false);
        store.addIntegration('supabase');
        expect(store.selectableConnectionsOf('supabase').map(connection => connection.id)).toEqual(['workspace-id']);
        expect(store.isConnectionUsable('workspace-id')).toBe(true);
    });
});
