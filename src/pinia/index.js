import { createPinia } from 'pinia';
import { createPersistedState } from 'pinia-plugin-persistedstate';

const getCookieDomain = () => {
    const hostname = window.location.hostname;

    // Handle localhost (both subdomains and exact) - no domain for localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
        return undefined;
    }

    // Handle weweb domains
    const match = hostname.match(/\.?(weweb[^.]*\.io)$/);
    return match ? `.${match[1]}` : undefined;
};

// Custom cookie storage for cross-domain editor preferences
export const cookieStorage = {
    getItem: key => {
        const cookies = document.cookie.split('; ');
        const cookie = cookies.find(c => c.startsWith(key + '='));
        return cookie ? decodeURIComponent(cookie.split('=')[1]) : null;
    },
    setItem: (key, value) => {
        const domain = getCookieDomain();
        const maxAge = 365 * 24 * 60 * 60; // 1 year in seconds

        let cookieString = `${key}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
        if (domain) {
            cookieString += `; domain=${domain}`;
        }

        document.cookie = cookieString;
    },
    removeItem: key => {
        const domain = getCookieDomain();
        let cookieString = `${key}=; path=/; max-age=0`;
        if (domain) {
            cookieString += `; domain=${domain}`;
        }
        document.cookie = cookieString;
    },
};

const pinia = createPinia();

pinia.use(
    createPersistedState({
        storage: cookieStorage,
        auto: false,
        serializer: {
            serialize: JSON.stringify,
            deserialize: JSON.parse,
        },
    })
);

export default pinia;
