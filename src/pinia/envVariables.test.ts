import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deleteEnvVariable: vi.fn(),
}));

vi.mock('@/_manager/backend/envVariables.service.js', () => ({
    createEnvVariable: vi.fn(),
    updateEnvVariable: vi.fn(),
    deleteEnvVariable: mocks.deleteEnvVariable,
    getAllEnvVariables: vi.fn(),
}));

import { useEnvVariablesStore } from './envVariables.js';

const project = (name: string, id = `project-${name}`) => ({ id, name, editorValue: 'project value' });
const workspace = (name: string, id = `workspace-${name}`) => ({
    id,
    name,
    editorValue: 'workspace value',
    workspaceId: 'workspace-id',
    connectionId: 'connection-id',
});

/* A project variable named with the workspace prefix before it was reserved wins over the workspace's of the same name,
   whatever the casing, as on the project's servers and in its published apps. */
describe('useEnvVariablesStore, a project variable and a workspace one of the same name', () => {
    let store: ReturnType<typeof useEnvVariablesStore>;
    const valueOf = (name: string) => (store.values as Record<string, unknown>)[name];

    beforeEach(() => {
        setActivePinia(createPinia());
        store = useEnvVariablesStore();
        mocks.deleteEnvVariable.mockReset();
    });

    it("keeps the project's whichever comes first", () => {
        store.add(project('WORKSPACE_API_KEY'));
        store.add(workspace('WORKSPACE_API_KEY'));
        expect(Object.values(store.values)).toEqual([project('WORKSPACE_API_KEY')]);

        setActivePinia(createPinia());
        const other = useEnvVariablesStore();
        other.add(workspace('WORKSPACE_API_KEY'));
        other.add(project('WORKSPACE_API_KEY'));
        expect(Object.values(other.values)).toEqual([project('WORKSPACE_API_KEY')]);
    });

    it("keeps the project's whatever the casing", () => {
        store.add(project('workspace_api_key'));
        store.add(workspace('WORKSPACE_API_KEY'));

        expect(Object.keys(store.values)).toEqual(['workspace_api_key']);
    });

    it("removes only the workspace's when it goes, the project's staying", async () => {
        store.add(project('WORKSPACE_API_KEY'));
        store.add(workspace('WORKSPACE_API_KEY'));

        store.remove({ id: 'workspace-WORKSPACE_API_KEY' });
        expect(valueOf('WORKSPACE_API_KEY')).toEqual(project('WORKSPACE_API_KEY'));

        store.replaceWorkspaceVariables([]);
        expect(valueOf('WORKSPACE_API_KEY')).toEqual(project('WORKSPACE_API_KEY'));
    });

    it("shows the workspace's again once the project's goes, or is renamed", async () => {
        store.add(project('WORKSPACE_API_KEY'));
        store.add(workspace('WORKSPACE_API_KEY'));

        await store.delete(project('WORKSPACE_API_KEY'));
        expect(mocks.deleteEnvVariable).toHaveBeenCalledWith('project-WORKSPACE_API_KEY');
        expect(valueOf('WORKSPACE_API_KEY')).toEqual(workspace('WORKSPACE_API_KEY'));

        store.add(project('WORKSPACE_API_KEY'));
        expect(valueOf('WORKSPACE_API_KEY')).toEqual(project('WORKSPACE_API_KEY'));
        store.add(project('API_KEY', 'project-WORKSPACE_API_KEY'));
        expect(store.values).toEqual({
            API_KEY: project('API_KEY', 'project-WORKSPACE_API_KEY'),
            WORKSPACE_API_KEY: workspace('WORKSPACE_API_KEY'),
        });
    });

    it('replaces the workspace variables, hidden ones included, leaving the project ones', () => {
        store.add(project('WORKSPACE_API_KEY'));
        store.add(project('OTHER'));
        store.add(workspace('WORKSPACE_API_KEY'));
        store.add(workspace('WORKSPACE_GONE'));

        store.replaceWorkspaceVariables([workspace('WORKSPACE_NEW')]);
        expect(Object.keys(store.values).sort()).toEqual(['OTHER', 'WORKSPACE_API_KEY', 'WORKSPACE_NEW']);

        // The hidden one is gone too: it does not come back with the project's.
        store.remove({ id: 'project-WORKSPACE_API_KEY' });
        expect(Object.keys(store.values).sort()).toEqual(['OTHER', 'WORKSPACE_NEW']);
    });

    it('removes by name a variable without id only', () => {
        store.add(project('OTHER'));

        store.remove({ id: 'unknown-id', name: 'OTHER' });
        expect(valueOf('OTHER')).toBeDefined();

        store.remove({ name: 'OTHER' });
        expect(valueOf('OTHER')).toBeUndefined();
    });
});
