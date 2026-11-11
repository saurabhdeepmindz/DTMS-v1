export const isDevelopment = () => process.env.NODE_ENV === 'development';

export const getAppUrls = () => {
    try {
        return JSON.parse(process.env.APP_URL);
    } catch {
        return [process.env.APP_URL];
    }
};

export const isLocalhostOrigin = origin => origin?.includes('localhost');

export const getTrustedOrigins = request => {
    const origins = getAppUrls();
    if (isDevelopment()) {
        const origin = request?.headers?.get('origin');
        if (isLocalhostOrigin(origin)) {
            origins.push(origin);
        }
    }
    return origins;
};

export const getCorsOrigin = origin => {
    if (isDevelopment() && isLocalhostOrigin(origin)) {
        return origin;
    }
    const appUrls = getAppUrls();
    return appUrls.includes(origin) ? origin : appUrls[0];
};
