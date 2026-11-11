import { accessErrorMessage } from '@/_common/helpers/accessPermissions.ts';

/**
 * An internal app (`design.appAccess`): only the people its own server grants it may use its published app, signing in
 * with their company account. Every page, backend workflow and table view then requires signing in, whatever its own
 * setting, and its sign-in is WeWeb's to set up, never edited in the editor.
 */
export function isInternalApp(): boolean {
    return wwLib?.store?.websiteData?.designInfo?.appAccess === 'internal';
}

/**
 * Whether the user manages who can use the open project's published app, as the server checks it: the project's `access`
 * permission, or the workspace's.
 */
export function canManageAppAccess(): boolean {
    const manager = wwLib?.store?.manager;
    return !!(manager?.hasProjectPermission('access') || manager?.hasWorkspacePermission('access'));
}

export const INTERNAL_APP_SECURITY_NOTE =
    'Internal app: only the people granted it, signed in with their company account, can reach it.';

export const INTERNAL_APP_AUTH_NOTE =
    "Internal app: people sign in with their company account, through your workspace's single sign-on. WeWeb sets it up: it can't be changed here.";

/**
 * Who may use a project's published app, chosen when it is created: anyone (`public`), or only the people its own
 * server grants it, signing in with their company account through the workspace's single sign-on (`internal`).
 * Opening the project in the editor never counts.
 */
export type AppAccessMode = 'public' | 'internal';

/** An internal app's published environments: each one's database holds its own grants. */
export type AppAccessTarget = 'staging' | 'production';

/** What publishing an internal app takes: until each is true, the publish is refused (400 `APP_ACCESS_NOT_READY`). */
export interface AppAccessReadiness {
    /** The workspace has an active single sign-on connection. */
    connection: boolean;
    /** The workspace's OAuth client for published apps is set up, on the Single sign-on page. */
    client: boolean;
    /** The project's WeWeb backend is set up. */
    backend: boolean;
    database: boolean;
    /** The project authenticates its users with WeWeb Auth. */
    auth: boolean;
}

/** One of an internal app's environments: whether WeWeb reaches its database, and how far into the directory it got. */
export interface AppAccessTargetStatus {
    target: AppAccessTarget;
    /** Has a database there, published or not. */
    isSetUp: boolean;
    /** The last directory change it holds, of `directory.latestSeq`. */
    seq: number;
    deliveredAt: string | null;
    lastError: string | null;
}

/** A project's published app access, as `GET /v2/projects/:projectId/app-access` answers it. */
export interface AppAccess {
    /** Whether the workspace has single sign-on, which an internal app takes: without it, only public apps are offered. */
    available: boolean;
    mode: AppAccessMode;
    readiness: AppAccessReadiness;
    /** The directory people sign in with: the workspace's connection's. */
    provider: 'google' | 'microsoft' | null;
    /** WeWeb's copy of the directory, which it pushes to each server: its last change, and its last sync. */
    directory: { latestSeq: number; lastSyncAt: string | null };
    targets: AppAccessTargetStatus[];
}

/** A person of the company directory, as an internal app's server holds it. `deleted`: no longer in it. */
export interface AppDirectoryUser {
    subject: string;
    email: string | null;
    name: string | null;
    /** Their photo, when the provider gives one. */
    image: string | null;
    status: 'active' | 'suspended' | 'deleted';
    /** The workspace member they are, by their email, as WeWeb answers it: `null` when none. */
    member?: AppMember | null;
}

/** A person of the directory as a member of the workspace: as its Members page shows them. */
export interface AppMember {
    isOwner: boolean;
    isGuest: boolean;
    picture: string | null;
    /** Their role: `key` for the default ones (`admin`, `user`). */
    role: { key: string | null; name: string } | null;
}

/** A group of the company directory mirrored by the workspace; `deleted` once gone from it, kept for its grant. */
export interface AppDirectoryGroup {
    externalId: string;
    name: string;
    email: string | null;
    memberCount: number;
    deleted: boolean;
}

/** Who an internal app's server grants it to, and how much of the directory it holds. */
export interface AppServerAccess {
    state: {
        connectionId: string | null;
        seq: number;
        updatedAt: string | null;
        users: number;
        groups: number;
        grants: number;
        managed: number;
    };
    /** `managed`: those who can open every project of the workspace, given access by WeWeb, not to be removed here. */
    grants: { users: AppDirectoryUser[]; groups: AppDirectoryGroup[]; managed: AppDirectoryUser[] };
}

/**
 * Who an internal app's environments grant it (`environments`, those set up), and who of the workspace the directory
 * knows: its members' subjects by user id, its mirrored groups' directory IDs by group id.
 */
export interface ProjectAppGrants {
    environments: Partial<Record<AppAccessTarget, AppServerAccess>>;
    subjects: Record<string, string>;
    groupExternalIds: Record<string, string>;
}

/** What one is given in an environment: granted, given by WeWeb as their role opens every project, or nothing. */
export type GranteeEnvironmentAccess = 'granted' | 'managed' | 'none';

/** What a member or a group is given on each internal app of the workspace, by environment (`error`: unreachable). */
export interface GranteeAppAccess {
    /** How the directory knows them: `null` when it doesn't, nothing to give then. */
    key: { subject: string } | { groupExternalId: string } | null;
    projects: Record<string, Partial<Record<AppAccessTarget, GranteeEnvironmentAccess>> | { error: string }>;
}

/** "Production only": where one is granted, across the app's environments, when not everywhere (`mixed`). */
export function appGrantState(granted: Partial<Record<AppAccessTarget, boolean>>): {
    value: 'on' | 'off' | 'mixed';
    label: string;
} {
    const environments = APP_ACCESS_TARGETS.filter(item => item.target in granted);
    const on = environments.filter(item => granted[item.target]);
    if (!on.length) return { value: 'off', label: '' };
    if (on.length === environments.length) return { value: 'on', label: '' };
    return { value: 'mixed', label: `${on.map(item => item.label).join(' and ')} only` };
}

/** Why an app can't be made internal: it signs people in through the workspace's single sign-on. */
export const NO_CONNECTION_REASON =
    'Internal apps sign people in through single sign-on: connect your company directory on the Single sign-on page first.';

/** Where what an internal app needs is set up: the workspace's Single sign-on page, or the project's editor. */
type RequirementPlace = 'sso' | 'editor';

/** What publishing an internal app takes, and where each is set up. */
const APP_ACCESS_REQUIREMENTS: { key: keyof AppAccessReadiness; place: RequirementPlace }[] = [
    { key: 'connection', place: 'sso' },
    { key: 'client', place: 'sso' },
    { key: 'backend', place: 'editor' },
    { key: 'database', place: 'editor' },
    { key: 'auth', place: 'editor' },
];

/** An internal app's environments, in their order, and what is said while one isn't set up yet. */
export const APP_ACCESS_TARGETS: { target: AppAccessTarget; label: string; description: string; notSetUp: string }[] = [
    {
        target: 'staging',
        label: 'Staging',
        description: 'Its staging version, to try it before production',
        notSetUp: "Its backend isn't fully set up for staging yet.",
    },
    {
        target: 'production',
        label: 'Production',
        description: 'Its live version',
        notSetUp: "Its backend isn't fully set up for production yet.",
    },
];

const BLOCKER_TEXTS: Record<RequirementPlace, (missing: { key: string }[]) => string> = {
    sso: missing =>
        missing.some(item => item.key === 'connection')
            ? 'Connect your company directory on the Single sign-on page before publishing.'
            : 'Add your sign-in client on the Single sign-on page before publishing.',
    editor: () => "Its backend wasn't fully set up: open the editor to finish it before publishing.",
};

/**
 * What still blocks publishing an internal app, by where it's fixed: the workspace's sign-in on the Single sign-on page,
 * or the project's backend, set up with the project unless that failed. Nothing once ready.
 */
export function appAccessBlockers(
    readiness: AppAccessReadiness | null | undefined
): { place: RequirementPlace; text: string }[] {
    const missing = APP_ACCESS_REQUIREMENTS.filter(item => !readiness?.[item.key]);
    return (['sso', 'editor'] as const)
        .filter(place => missing.some(item => item.place === place))
        .map(place => ({ place, text: BLOCKER_TEXTS[place](missing.filter(item => item.place === place)) }));
}

/** Grants given or taken away: users by their directory subject, groups by their directory ID. */
export type AppGrantLists = { subjects: string[]; groupIds: string[] };

/** How a page reads and changes an environment's grants, through its own client (`AppGrantsList`). */
export interface AppGrantsApi {
    getGrants: (target: AppAccessTarget) => Promise<AppServerAccess>;
    /** Gives and takes away grants, the others kept: who it grants it then. */
    changeGrants: (
        target: AppAccessTarget,
        changes: { add: AppGrantLists; remove: AppGrantLists }
    ) => Promise<AppServerAccess>;
    search: (
        target: AppAccessTarget,
        query: string
    ) => Promise<{ users: AppDirectoryUser[]; groups: AppDirectoryGroup[] }>;
}

const APP_ACCESS_ERROR_MESSAGES: Record<string, string> = {
    APP_ACCESS_NO_CONNECTION: NO_CONNECTION_REASON,
    APP_ACCESS_SERVER_NOT_READY: "Its backend isn't fully set up there yet.",
    APP_ACCESS_SERVER_UPDATING: 'The editor server is updating. Try again in a minute.',
    APP_ACCESS_SETUP_FAILED: "The company directory couldn't be copied yet. WeWeb retries in a minute.",
    APP_ACCESS_SERVER_UNREACHABLE: "The app's server didn't answer. Try again in a moment.",
    APP_ACCESS_UNKNOWN_GRANTEES: "Some of them aren't in the company directory anymore.",
    APP_ACCESS_NO_DATABASE: 'The app has no database there.',
    APP_ACCESS_ENVIRONMENT_NOT_OFFERED:
        "The project's plan has no staging anymore: people can only be taken away from it, not given it.",
    APP_ACCESS_NOT_READY:
        "Its sign-in or backend isn't fully set up yet: see who can use it on the project's Access page.",
    APP_ACCESS_AUTH_LOCKED: "An internal app's sign-in is set up by WeWeb: it can't be changed.",
};

/** The message for an app access call the server refused, falling back on the access rules' messages. */
export function appAccessErrorMessage(err: unknown, fallback: string) {
    // As the dashboard's client answers it, or the editor's.
    const failure = err as { error?: { code?: string }; response?: { data?: { code?: string } } } | null;
    const code = failure?.error?.code || failure?.response?.data?.code;
    return (code && APP_ACCESS_ERROR_MESSAGES[code]) || accessErrorMessage(err, fallback);
}
