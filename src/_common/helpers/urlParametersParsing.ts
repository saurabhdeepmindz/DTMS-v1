export interface PathParameter {
    name: string;
    value: string;
    defaultValue: string;
}

export const PATH_PARAM_REGEX = /{{([^|}]+)\|([^/]*)?}}/g;
const INVALID_PARAM_NAME_CHARS = /[|}]/g;

export function sanitizePathParameterName(name: string): string {
    return name.replace(INVALID_PARAM_NAME_CHARS, '');
}

export function extractPathParameters(path: string, pathParameterValues: Record<string, string> = {}): PathParameter[] {
    const matches = [...path.matchAll(PATH_PARAM_REGEX)];
    return matches.map(([, name, defaultValue = '']) => ({
        name,
        value: pathParameterValues[name] || defaultValue || '',
        defaultValue,
    }));
}

export function updatePathParameterNameInPath(path: string, index: number, newName: string): string {
    let i = 0;
    return path.replace(PATH_PARAM_REGEX, (match, _paramName, defaultValue = '') => {
        if (i++ === index) {
            return `{{${newName}|${defaultValue}}}`;
        }
        return match;
    });
}

export function updatePathParameterDefaultValueInPath(path: string, index: number, newDefaultValue: string): string {
    let i = 0;
    return path.replace(PATH_PARAM_REGEX, (match, paramName) => {
        if (i++ === index) {
            return `{{${paramName}|${newDefaultValue}}}`;
        }
        return match;
    });
}

export function removePathParameterFromPath(path: string, index: number): string {
    let i = 0;
    const newPath = path.replace(PATH_PARAM_REGEX, match => {
        if (i++ === index) return '';
        return match;
    });
    return newPath.replace(/\/+/g, '/').replace(/\/$/, '');
}

export function replacePathParametersWithValues(basePath: string, pathParams: Record<string, string>): string {
    const paramNameMap = new Map<string, string>();
    basePath.replace(PATH_PARAM_REGEX, (match, variableId) => {
        paramNameMap.set(variableId.toLowerCase(), variableId);
        return match;
    });

    const lowerBasePath = basePath.toLowerCase();

    return lowerBasePath.replace(PATH_PARAM_REGEX, (_match, variableId, defaultValue = '') => {
        const originalVariableId = paramNameMap.get(variableId) || variableId;
        const value = pathParams[originalVariableId] || defaultValue;
        if (value) {
            return encodeURIComponent(value);
        }
        return `{{${variableId}}}`;
    });
}

export function validatePathUniqueness(
    value: string,
    currentPageId: string,
    pages: Array<{ id: string; name: string; paths: Record<string, string> }>,
    lang: string
): true | string {
    if (!value) return true;

    const normalizedPath = value.replace(PATH_PARAM_REGEX, '{{}}');

    const conflictingPage = pages.find(
        page =>
            page.id !== currentPageId &&
            page.paths[lang] &&
            page.paths[lang].replace(PATH_PARAM_REGEX, '{{}}') === normalizedPath
    );

    return conflictingPage ? `URL path already used by "${conflictingPage.name}" page.` : true;
}

export function convertPathToRouterFormat(path: string): string {
    return path.replace(PATH_PARAM_REGEX, ':$1');
}

export function normalizePathForComparison(path: string): string {
    return path.replace(PATH_PARAM_REGEX, '{{}}');
}

export function replacePathParametersWithDefaults(path: string): string {
    return path.toLowerCase().replace(PATH_PARAM_REGEX, (_match, variableId, defaultValue = '') => {
        return defaultValue || `{{${variableId}}}`;
    });
}
