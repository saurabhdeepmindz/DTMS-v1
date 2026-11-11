import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PERMISSION_TOPICS,
    CONNECTION_REMOVAL_REASON,
    PROJECT_REMOVAL_REASON,
    accessErrorMessage,
    currentPermissions,
    hasPermission,
    isWithinPermissions,
    normalizePermissions,
    permissionDeniedText,
    permissionLabel,
    permissionsLabel,
    permissionsPhrase,
    type AccessKind,
} from './accessPermissions';

const KINDS: AccessKind[] = ['workspace', 'project', 'connection'];
const EVERY_PUBLISH_ITEM = ['publish.staging', 'publish.production', 'publish.export', 'publish.domains'];

/**
 * weweb-back's `PERMISSION_TOPICS` and `DEFAULT_ROLES` (`core/new/accessPermissions.core.ts`), as it stores them: a
 * snapshot its own `test/accessPermissions.catalogSync.test.ts` checks the server's catalog against.
 */
const BACKEND_CATALOG: {
    topics: Record<AccessKind, { key: string; items: string[] }[]>;
    defaultRoles: Record<'admin' | 'user', { name: string; permissions: Record<AccessKind, string[]> }>;
} = JSON.parse(
    readFileSync(new URL('../../../../weweb-back/test/fixtures/accessPermissionsCatalog.json', import.meta.url), 'utf8')
);

describe('access permissions', () => {
    it('mirrors the catalog of the server exactly', () => {
        expect(Object.keys(BACKEND_CATALOG.topics)).toEqual(KINDS);
        for (const kind of KINDS) {
            expect(
                PERMISSION_TOPICS[kind].map(topic => ({ key: topic.key, items: topic.items.map(({ key }) => key) }))
            ).toEqual(BACKEND_CATALOG.topics[kind]);
        }
    });

    it("keeps the server's default roles normalized, as a role comes back", () => {
        for (const { permissions } of Object.values(BACKEND_CATALOG.defaultRoles)) {
            for (const kind of KINDS) expect(normalizePermissions(kind, permissions[kind])).toEqual(permissions[kind]);
        }
        // A User has every permission there is today on what they're given: what ticking them all holds.
        expect(BACKEND_CATALOG.defaultRoles.user.permissions.project).toEqual(currentPermissions('project'));
        expect(BACKEND_CATALOG.defaultRoles.user.permissions.connection).toEqual(currentPermissions('connection'));
    });

    it('lets a topic cover its items, and an item only itself', () => {
        expect(hasPermission(['publish'], 'publish.domains')).toBe(true);
        expect(hasPermission(['publish.staging'], 'publish.production')).toBe(false);
        expect(hasPermission(['publish.staging'], 'publish')).toBe(false);
    });

    it('spells a topic out as its items, in catalog order, and drops what the catalog does not know', () => {
        expect(normalizePermissions('project', ['settings', 'publish.production', 'publish'])).toEqual([
            ...EVERY_PUBLISH_ITEM,
            'settings',
        ]);
        expect(normalizePermissions('project', ['publish.domains', 'publish.export', 'publish.staging'])).toEqual([
            'publish.staging',
            'publish.export',
            'publish.domains',
        ]);
        // The keys of the former catalog are gone.
        expect(normalizePermissions('project', ['settings.backups', 'settings.domains', 'publish.export'])).toEqual([
            'publish.export',
        ]);
        expect(normalizePermissions('workspace', ['settings.general', 'members.invite', 'components'])).toEqual([]);
        // The project's Settings has no items any more: a role or a grant saved with them keeps neither.
        expect(normalizePermissions('project', ['settings.general', 'settings.delete', 'access'])).toEqual(['access']);
        // A connection's share access has no items any more.
        expect(normalizePermissions('connection', ['publish', 'access.members', 'edit'])).toEqual(['edit']);
    });

    it('never takes every permission ticked for full access: only `all` covers those added later', () => {
        const everyWorkspaceTopic = ['projects', 'connections', 'members', 'access', 'billing', 'settings'];
        expect(normalizePermissions('workspace', everyWorkspaceTopic)).toEqual(everyWorkspaceTopic);
        expect(permissionsLabel('workspace', everyWorkspaceTopic)).toBe(
            'Projects, Connections, Members, Access, Billing, Settings'
        );
        expect(normalizePermissions('project', ['publish', 'duplicate', 'access', 'settings'])).toEqual(
            currentPermissions('project')
        );
        expect(normalizePermissions('connection', ['edit', 'access'])).toEqual(['edit', 'access']);
        expect(currentPermissions('project')).toEqual([...EVERY_PUBLISH_ITEM, 'duplicate', 'access', 'settings']);
        expect(normalizePermissions('project', ['access', 'all'])).toEqual(['all']);
        // Holding every permission there is today is less than `all`.
        expect(isWithinPermissions(['all'], currentPermissions('connection'))).toBe(false);
    });

    it('has a single project Settings permission', () => {
        expect(PERMISSION_TOPICS.project.find(({ key }) => key === 'settings')).toEqual({
            key: 'settings',
            label: 'Settings',
            description:
                'Rename the project, set its deploy hook, and choose which resources the AI agent must not change',
            items: [],
        });
        expect(hasPermission(['settings'], 'settings')).toBe(true);
        expect(hasPermission(['settings.general'], 'settings')).toBe(false);
    });

    it('only lets one give what they hold', () => {
        expect(isWithinPermissions(['publish.staging'], ['publish'])).toBe(true);
        expect(isWithinPermissions(['publish'], ['publish.staging', 'publish.production'])).toBe(false);
        expect(isWithinPermissions(['all'], ['settings', 'billing'])).toBe(false);
        expect(isWithinPermissions([], [])).toBe(true);
    });

    it('names full access as such, the others by what they hold, and none by what it still allows', () => {
        expect(permissionsLabel('project', ['all'])).toBe('Full access');
        expect(permissionsLabel('project', ['publish.staging'])).toBe('Publish (Staging)');
        expect(permissionsLabel('connection', ['edit'])).toBe('Edit');
        // Opening the project, or using the connection, and nothing more.
        expect(permissionsLabel('project', [])).toBe('Open and edit only');
        expect(permissionsLabel('connection', [])).toBe('Use only');
        expect(permissionsLabel('workspace', [])).toBe('None');
        expect(permissionsLabel('project', null)).toBe('');
        expect(permissionsLabel('project', ['publish.staging', 'publish.production'])).toBe(
            'Publish (Staging, Production)'
        );
        expect(permissionsLabel('project', ['publish', 'access'])).toBe('Publish, Access');
        // A topic's every item, by the topic's name.
        expect(permissionsLabel('project', [...EVERY_PUBLISH_ITEM, 'settings'])).toBe('Publish, Settings');
        expect(permissionsLabel('connection', ['access'])).toBe('Share access');
    });

    it('names the workspace permissions: full access, and the others by what they hold', () => {
        expect(permissionsLabel('workspace', ['all'])).toBe('Full access');
        expect(permissionsLabel('workspace', ['billing', 'members'])).toBe('Members, Billing');
        expect(permissionsLabel('workspace', ['settings', 'projects', 'access'])).toBe('Projects, Access, Settings');
        expect(hasPermission(['all'], 'billing')).toBe(true);
        expect(hasPermission([], 'billing')).toBe(false);
        expect(hasPermission(['settings', 'projects'], 'all')).toBe(false);
    });

    it('names a permission for a message, the workspace and connection ones apart from the project ones', () => {
        expect(permissionLabel('project', 'settings')).toBe('Settings');
        expect(permissionLabel('project', 'publish.domains')).toBe('Publish › Domains');
        expect(permissionLabel('workspace', 'billing')).toBe('Billing');
        expect(permissionsPhrase('workspace', ['billing'])).toBe('the Billing workspace permission');
        expect(permissionsPhrase('project', ['publish.staging', 'settings'])).toBe(
            'the Publish › Staging and Settings project permissions'
        );
        expect(permissionsPhrase('workspace', ['all'])).toBe('every workspace permission');
        expect(permissionDeniedText({ permission: 'members', scope: 'workspace' })).toBe(
            'You need the Members workspace permission to do this. Ask someone with full access to the workspace.'
        );
        expect(permissionDeniedText({ permission: 'publish.domains', scope: 'project' })).toBe(
            'You need the Publish › Domains project permission to do this. Ask someone with full access to the workspace.'
        );
        // The kind is the scope's, whatever the key: `access` is a project's and a connection's.
        expect(permissionDeniedText({ permission: 'access', scope: 'connection' })).toBe(
            'You need the Share access connection permission to do this. Ask someone with full access to the workspace.'
        );
        // Every permission on a connection.
        expect(permissionDeniedText({ permission: 'all', scope: 'connection' })).toBe(
            'You need full access to this connection to do this. Ask someone with full access to the workspace.'
        );
        expect(permissionDeniedText({ permission: 'publish.domains' })).toBe(
            'You need the Publish › Domains project permission to do this. Ask someone with full access to the workspace.'
        );
        expect(permissionDeniedText({ scope: 'workspace' })).toBe(
            "You don't have the permission to do this in this workspace."
        );
        // A refused project delete or transfer: its creator may too.
        expect(permissionDeniedText({ permission: 'projects', scope: 'workspace' })).toBe(PROJECT_REMOVAL_REASON);
        expect(PROJECT_REMOVAL_REASON).toBe(
            "Only the project's creator, or someone with the Projects permission, can delete or transfer it."
        );
        // A refused connection delete: its creator may too.
        expect(permissionDeniedText({ permission: 'connections', scope: 'workspace' })).toBe(CONNECTION_REMOVAL_REASON);
        expect(CONNECTION_REMOVAL_REASON).toBe(
            "Only the connection's creator, or someone with the Connections permission, can delete it."
        );
    });

    it('words a refusal from the dashboard or from the editor alike', () => {
        const denied = { code: 'PERMISSION_DENIED', permission: 'billing', scope: 'workspace' };
        const text =
            'You need the Billing workspace permission to do this. Ask someone with full access to the workspace.';
        expect(accessErrorMessage({ status: 403, error: denied }, 'Failed')).toBe(text);
        expect(accessErrorMessage({ response: { status: 403, data: denied } })).toBe(text);
        expect(accessErrorMessage({ response: { data: { code: 'CONNECTION_ACCESS_DENIED' } } })).toBe(
            'This connection is not in this project.'
        );
        expect(accessErrorMessage({ status: 403, error: { code: 'ACCESS_PERMISSIONS_EXCEEDED' } }, 'Failed')).toBe(
            'You can only give the permissions you have.'
        );
        expect(accessErrorMessage({ status: 403, error: { code: 'OWNER_ONLY' } }, 'Failed')).toBe(
            'Only the owner of this workspace can do this.'
        );
        expect(accessErrorMessage({ status: 403, error: { code: 'ACCESS_ABOVE_ROLE' } }, 'Failed')).toBe(
            'Giving more than a role gives takes the Access workspace permission, and only the permissions you have.'
        );
        expect(accessErrorMessage({ status: 409, error: { code: 'ROLE_NAME_TAKEN' } }, 'Failed')).toBe(
            'A role with this name already exists in the workspace.'
        );
        expect(accessErrorMessage({ status: 400, error: { code: 'ROLE_DEFAULT_FIXED' } }, 'Failed')).toBe(
            "Every workspace has its default roles: they can't be deleted."
        );
        expect(
            accessErrorMessage({
                status: 403,
                error: { code: 'PERMISSION_DENIED', permission: 'projects', scope: 'workspace' },
            })
        ).toBe(PROJECT_REMOVAL_REASON);
        expect(accessErrorMessage({ status: 500, error: { code: 'SOMETHING_ELSE' } }, 'Failed')).toBe('Failed');
        expect(accessErrorMessage(new Error('Network Error'))).toBe('');
        expect(accessErrorMessage(null, 'Failed')).toBe('Failed');
    });
});
