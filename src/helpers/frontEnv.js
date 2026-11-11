let frontEnvVariables;

export function mapEnvironmentValuesToEnvVariables(valuesByEnvironment) {
    if (!valuesByEnvironment || typeof valuesByEnvironment !== 'object' || Array.isArray(valuesByEnvironment)) {
        throw new Error('Missing or invalid bundled front env variables');
    }

    const values = {};

    for (const env of ['staging', 'production']) {
        const environmentValues = valuesByEnvironment[env];
        if (!environmentValues || typeof environmentValues !== 'object' || Array.isArray(environmentValues)) {
            continue;
        }

        for (const [name, value] of Object.entries(environmentValues)) {
            if (!values[name]) values[name] = { name };
            values[name][`${env}Value`] = value;
        }
    }

    return values;
}

function parseAppUrls(value) {
    if (!value) return [];

    if (typeof value !== 'string') {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
            return parsed.filter(url => typeof url === 'string' && url);
        }
    } catch {
    }

    return [value];
}

function getOrigin(url) {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

function resolveEnvironmentFromOrigin(currentOrigin) {
    return currentOrigin?.includes('-staging.') ? 'staging' : 'production';
}

export function getFrontEnvVariables() {
     /* wwFront:start */
    if (!frontEnvVariables) {
        // eslint-disable-next-line no-undef
        frontEnvVariables = mapEnvironmentValuesToEnvVariables(__WW_FRONT_ENV_VARIABLES__);
    }

    return frontEnvVariables;
    /* wwFront:end */
}

export function resolveEnvironmentFromEnvVariables(values, currentOrigin = window.location.origin) {
    const appUrl = values?.APP_URL;
    if (!appUrl || typeof appUrl !== 'object') {
        return resolveEnvironmentFromOrigin(currentOrigin);
    }

    for (const env of ['staging', 'production']) {
        const envUrls = parseAppUrls(appUrl[`${env}Value`]);
        if (envUrls.some(url => getOrigin(url) === currentOrigin)) {
            return env;
        }
    }

    return resolveEnvironmentFromOrigin(currentOrigin);
}

export function getRuntimeEnvironment(currentOrigin = window.location.origin) {
     /* wwFront:start */
    return resolveEnvironmentFromEnvVariables(getFrontEnvVariables(), currentOrigin);
    /* wwFront:end */
}
