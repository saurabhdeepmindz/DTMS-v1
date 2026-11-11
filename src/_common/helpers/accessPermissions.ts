/**
 * What a member may do: across the workspace, on the projects they open and on the workspace connections they use.
 * Each member has a role, which holds the permissions of each kind: across the workspace (`workspace`), and by default
 * on the projects (`project`) and the connections (`connection`) they are given. A role's `projects` (`connections`)
 * workspace permission gives them every project (connection) with its project (connection) permissions. A grant of a
 * project or a connection gives its grantee's role permissions of that kind (inherit), or its own. A list holds
 * permission keys: `all`, a topic without items (`access`), or one of a topic's items (`publish.<item>`). Only `all`,
 * chosen as such, covers the permissions added later: any other list holds exactly what was ticked, every permission
 * ticked included. A topic with items is held as its items; one stored as a topic before (`publish`) still covers
 * them. The workspace's owner holds `all` everywhere, whatever their role. Mirrors weweb-back's
 * `core/new/accessPermissions.core.ts`.
 */

export type AccessKind = 'workspace' | 'project' | 'connection';

/** What is given apart from the workspace itself: a project, or a workspace connection. */
export type ResourceKind = Exclude<AccessKind, 'workspace'>;

export type PermissionItem = { key: string; label: string; description?: string };
export type PermissionTopic = PermissionItem & { items: PermissionItem[] };

export const ALL_PERMISSIONS = 'all';

export const PERMISSION_TOPICS: Record<AccessKind, PermissionTopic[]> = {
    workspace: [
        {
            key: 'projects',
            label: 'Projects',
            description: "Every project, with the role's project permissions",
            items: [],
        },
        {
            key: 'connections',
            label: 'Connections',
            description: "Every connection, with the role's connection permissions",
            items: [],
        },
        { key: 'members', label: 'Members', description: 'Invite and remove members and guests', items: [] },
        {
            key: 'access',
            label: 'Access',
            description:
                "Manage the roles and the groups, choose each member's role, and who can open each project and use each connection",
            items: [],
        },
        { key: 'billing', label: 'Billing', description: 'Plans, seats, billing information and invoices', items: [] },
        {
            key: 'settings',
            label: 'Settings',
            description: 'Workspace name, GitHub, API keys and self-hosting, and the AI gateway',
            items: [],
        },
    ],
    project: [
        {
            key: 'publish',
            label: 'Publish',
            description: 'Publish and export the project, and connect its domains',
            items: [
                { key: 'publish.staging', label: 'Staging', description: 'Publish to staging, on plans that have it' },
                {
                    key: 'publish.production',
                    label: 'Production',
                    description: 'Publish to production, promote, roll back and unpublish',
                },
                {
                    key: 'publish.export',
                    label: 'Export',
                    description: 'Export the code and download it, on plans that have it',
                },
                { key: 'publish.domains', label: 'Domains', description: 'Connect and remove custom domains' },
            ],
        },
        {
            key: 'duplicate',
            label: 'Duplicate',
            description:
                "Copy the project in this workspace: they get their role's access on the copy, not what they hold here",
            items: [],
        },
        { key: 'access', label: 'Access', description: 'Choose who can open the project', items: [] },
        {
            key: 'settings',
            label: 'Settings',
            description:
                'Rename the project, set its deploy hook, and choose which resources the AI agent must not change',
            items: [],
        },
    ],
    connection: [
        {
            key: 'edit',
            label: 'Edit',
            description: 'Change the connection settings and reveal its secret values',
            items: [],
        },
        {
            key: 'access',
            label: 'Share access',
            description: 'Choose which members and groups can use the connection',
            items: [],
        },
    ],
};

/** What holding none of a kind's permissions still allows, as a summary names it. */
const NO_PERMISSIONS_LABELS: Record<AccessKind, string> = {
    workspace: 'None',
    project: 'Open and edit only',
    connection: 'Use only',
};

function topicOf(key: string) {
    return key.split('.')[0];
}

export function hasPermission(granted: readonly string[] | null | undefined, required: string): boolean {
    if (!granted) return false;
    if (granted.includes(ALL_PERMISSIONS) || granted.includes(required)) return true;
    return required.includes('.') && granted.includes(topicOf(required));
}

/** Whether `owned` covers every key of `permissions`, as one may only give what one holds. */
export function isWithinPermissions(
    permissions: readonly string[],
    owned: readonly string[] | null | undefined
): boolean {
    if (!owned) return false;
    if (owned.includes(ALL_PERMISSIONS)) return true;
    return permissions.every(key => key !== ALL_PERMISSIONS && hasPermission(owned, key));
}

/**
 * The list as stored, in catalog order: `all` alone, or exactly what is held, nothing twice: a topic without items as
 * itself, a topic with items as its items (all of them, for the topic). Only `all` covers what is added later: ticking
 * every permission, or every item of a topic, still leaves it out. A key the catalog no longer knows drops out.
 */
export function normalizePermissions(kind: AccessKind, permissions: readonly string[]): string[] {
    if (permissions.includes(ALL_PERMISSIONS)) return [ALL_PERMISSIONS];
    return PERMISSION_TOPICS[kind].flatMap(topic => {
        if (!topic.items.length) return permissions.includes(topic.key) ? [topic.key] : [];
        const itemKeys = topic.items.map(({ key }) => key);
        return permissions.includes(topic.key) ? itemKeys : itemKeys.filter(key => permissions.includes(key));
    });
}

/** Every permission of a kind as it is today, spelled out: what ticking them all holds, unlike `all`. */
export function currentPermissions(kind: AccessKind): string[] {
    return PERMISSION_TOPICS[kind].flatMap(topic =>
        topic.items.length ? topic.items.map(({ key }) => key) : [topic.key]
    );
}

/**
 * For a summary: "Full access" for `all`, else each topic held, by its name when all its items are, with them when
 * only some are ("Publish (Staging), Access"), or what holding none still allows.
 */
export function permissionsLabel(kind: AccessKind, permissions: readonly string[] | null | undefined): string {
    if (!permissions) return '';
    if (permissions.includes(ALL_PERMISSIONS)) return 'Full access';
    const labels: string[] = [];
    for (const topic of PERMISSION_TOPICS[kind]) {
        const items = topic.items.filter(item => hasPermission(permissions, item.key));
        if (permissions.includes(topic.key) || (topic.items.length && items.length === topic.items.length)) {
            labels.push(topic.label);
        } else if (items.length) {
            labels.push(`${topic.label} (${items.map(item => item.label).join(', ')})`);
        }
    }
    return labels.join(', ') || NO_PERMISSIONS_LABELS[kind];
}

/** One permission's name, for a message: a topic's label, or an item's under its topic's ("Publish › Domains"). */
export function permissionLabel(kind: AccessKind, permission: string): string {
    for (const topic of PERMISSION_TOPICS[kind]) {
        if (topic.key === permission) return topic.label;
        const item = topic.items.find(({ key }) => key === permission);
        if (item) return `${topic.label} › ${item.label}`;
    }
    return permission;
}

/** A piece of `permissionsPhrase`: the permissions' names (`isName`) apart, for a notice to set them in bold. */
export type PhrasePart = { text: string; isName?: boolean };

/** `permissionsPhrase` in pieces. */
export function permissionsPhraseParts(kind: AccessKind, permissions: readonly string[]): PhrasePart[] {
    if (permissions.includes(ALL_PERMISSIONS)) return [{ text: `every ${kind} permission` }];
    const parts: PhrasePart[] = [{ text: 'the ' }];
    permissions.forEach((permission, index) => {
        if (index) parts.push({ text: index === permissions.length - 1 ? ' and ' : ', ' });
        parts.push({ text: permissionLabel(kind, permission), isName: true });
    });
    parts.push({ text: ` ${kind} ${permissions.length > 1 ? 'permissions' : 'permission'}` });
    return parts;
}

/**
 * "the Billing workspace permission", "the Publish › Staging and Settings project permissions", or "every workspace
 * permission" for `all`, which only a full access grant holds.
 */
export function permissionsPhrase(kind: AccessKind, permissions: readonly string[]): string {
    return permissionsPhraseParts(kind, permissions)
        .map(({ text }) => text)
        .join('');
}

/**
 * Why one may not delete a project, or transfer it to another workspace: the server refuses it as lacking the
 * `projects` workspace permission, which only those deletes and transfers ask for.
 */
export const PROJECT_REMOVAL_REASON =
    "Only the project's creator, or someone with the Projects permission, can delete or transfer it.";

/**
 * Why one may not delete a workspace connection: the server refuses it as lacking the `connections` workspace
 * permission, which only those deletes ask for.
 */
export const CONNECTION_REMOVAL_REASON =
    "Only the connection's creator, or someone with the Connections permission, can delete it.";

/** Why a permission beyond the editing user's own can't be given. */
export const OWNED_PERMISSIONS_REASON = 'You can only give the permissions you have.';

/** Why a grant giving more than its grantee's role can't be given: that takes the workspace's `access` permission. */
export const ABOVE_ROLE_REASON = 'Giving more than their role gives takes the Access workspace permission.';

const DENIED_WHERE: Record<AccessKind, string> = {
    workspace: 'in this workspace',
    project: 'on this project',
    connection: 'on this connection',
};

/** A call the server refused, as it words it: `{ code, permission, scope }`. */
export type AccessRefusal = { code?: string; permission?: string; scope?: string };

/**
 * Why the server refused a call for a missing permission (403 `{ code: 'PERMISSION_DENIED', permission, scope }`):
 * `scope` names the kind of the permission, a project's without one. The workspace's `projects` is only asked for to
 * delete or transfer a project, which its creator may too (`PROJECT_REMOVAL_REASON`), and its `connections` to delete a
 * connection, the same (`CONNECTION_REMOVAL_REASON`).
 */
export function permissionDeniedText({ permission, scope }: AccessRefusal = {}): string {
    const kind: AccessKind = scope === 'workspace' || scope === 'connection' ? scope : 'project';
    if (!permission) return `You don't have the permission to do this ${DENIED_WHERE[kind]}.`;
    if (kind === 'workspace' && permission === 'projects') return PROJECT_REMOVAL_REASON;
    if (kind === 'workspace' && permission === 'connections') return CONNECTION_REMOVAL_REASON;
    if (permission === ALL_PERMISSIONS && kind !== 'workspace') {
        return `You need full access to this ${kind} to do this. Ask someone with full access to the workspace.`;
    }
    return `You need ${permissionsPhrase(kind, [permission])} to do this. Ask someone with full access to the workspace.`;
}

/** What the access rules refuse a call for, as the user should read it, by `code`. */
const ACCESS_ERROR_MESSAGES: Record<string, string> = {
    ACCESS_PERMISSIONS_EXCEEDED: OWNED_PERMISSIONS_REASON,
    ACCESS_PROJECT_FORBIDDEN: 'You can only give this connection to projects you can open.',
    ACCESS_CONNECTION_FORBIDDEN: 'You can only give this project connections you can use.',
    ACCESS_MANAGEMENT_FORBIDDEN: "You can't change who has access to this.",
    ACCESS_USER_NOT_IN_WORKSPACE: 'Some of these people are no longer in the workspace.',
    ACCESS_GROUP_NOT_IN_WORKSPACE: 'Some of these groups no longer exist.',
    FULL_ACCESS_REQUIRED: 'Only members with full access to the workspace can change its company directory.',
    IDP_SETUP_EMAILS_LIMIT: 'Too many emails were sent from this workspace in the last hour. Try again later.',
    GROUP_MANAGED_BY_IDP: "Groups come from your company's directory now: add them from the Single sign-on settings.",
    MEMBER_MANAGED_BY_IDP: "Your company's directory manages this member: remove them there.",
    MEMBERS_MANAGED_BY_IDP: "Your company's directory manages who is in this workspace: suspend or remove them there.",
    ACCESS_PROJECT_NOT_IN_WORKSPACE: 'Some of these projects are no longer in the workspace.',
    ACCESS_CONNECTION_NOT_IN_WORKSPACE: 'Some of these connections are no longer in the workspace.',
    ACCESS_OWNER_FIXED: "The owner's role can't be changed: they always have every permission.",
    ACCESS_OWN_RAISE:
        "You can't give yourself more access than you have. Ask someone with full access to the workspace.",
    ACCESS_BEYOND_OWN:
        'You can only give the permissions you have on it, even within their role. Ask someone with full access to the workspace.',
    ACCESS_ROLE_BEYOND_OWN:
        'This would give someone more than you have on a project or connection whose access follows their role. Ask someone with full access to the workspace.',
    ACCESS_CREATOR_PROTECTED:
        'Only members with the Access workspace permission can remove the person who created it, which lets them delete it.',
    ACCESS_ABOVE_ROLE:
        'Giving more than a role gives takes the Access workspace permission, and only the permissions you have.',
    ROLE_NAME_TAKEN: 'A role with this name already exists in the workspace.',
    ROLE_DEFAULT_FIXED: "Every workspace has its default roles: they can't be deleted.",
    OWNER_ONLY: 'Only the owner of this workspace can do this.',
    CONNECTION_ACCESS_DENIED: 'This connection is not in this project.',
    CONNECTION_USED_BY_AUTH:
        "A project authenticates its users through this connection. Change the project's authentication before removing it.",
    CONNECTION_USED_BY_STORAGE:
        "A project stores its files through this connection. Change the project's storage before removing it.",
};

/**
 * The message for a call the server refused, whether the dashboard's `http` rejected it (`{ status, error }`) or
 * axios (`{ response: { data } }`): a missing permission is named in its kind; `fallback` for any other error.
 */
export function accessErrorMessage(err: unknown, fallback = ''): string {
    const failure = err as { error?: AccessRefusal; response?: { data?: AccessRefusal } } | null | undefined;
    const refusal = failure?.response?.data || failure?.error;
    if (refusal?.code === 'PERMISSION_DENIED') return permissionDeniedText(refusal);
    return (refusal?.code && ACCESS_ERROR_MESSAGES[refusal.code]) || fallback;
}
