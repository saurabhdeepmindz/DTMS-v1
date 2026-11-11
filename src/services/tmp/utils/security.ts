export interface SecurityConfig {
    accessRule?: 'public' | 'private';
    accessRoles?: readonly string[];
    accessRolesCondition?: 'OR' | 'AND';
}

export function checkAccess(security: SecurityConfig | null | undefined, userRoles: string[] = []): boolean {
    if (!security) return true;
    if (security.accessRule === 'public') return true;

    if (!security.accessRoles?.length) {
        return true;
    }

    if (!userRoles.length) return false;

    if (security.accessRolesCondition === 'OR') {
        return security.accessRoles.some(role => userRoles.includes(role));
    } else {
        return security.accessRoles.every(role => userRoles.includes(role));
    }
}
