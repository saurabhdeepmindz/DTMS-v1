/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_ADMIN_URL: string;
    readonly VITE_APP_API_URL: string;
    readonly VITE_APP_API_WEBSOCKETS: string;
    readonly VITE_APP_APOLLO_URL: string;
    readonly VITE_APP_BUCKET_URL: string;
    readonly VITE_APP_CDN_URL: string;
    readonly VITE_APP_CDN_URL_SHORT: string;
    readonly VITE_APP_DASHBOARD_BASE_URL: string;
    readonly VITE_APP_DASHBOARD_URL: string;
    readonly VITE_APP_EDITOR_DEV_URL: string;
    readonly VITE_APP_EDITOR_DOMAIN: string;
    readonly VITE_APP_EDITOR_URL: string;
    readonly VITE_APP_ENV_MODE: string;
    readonly VITE_APP_GITHUB_OAUTH_CLIENT_ID: string;
    readonly VITE_APP_HOSTNAME: string;
    readonly VITE_APP_IS_EDITOR_DEV: string;
    readonly VITE_APP_LOG_INGEST_URL?: string;
    readonly VITE_APP_PLUGINS_URL: string;
    readonly VITE_APP_PREVIEW_URL: string;
    readonly VITE_APP_SEGMENT_KEY: string;
    readonly VITE_APP_STRIPE_PUBLIC_KEY: string;
    readonly VITE_APP_SURVEYS_API_URL: string;
    readonly VITE_APP_SURVEYS_SUPABASE_KEY: string;
    readonly VITE_APP_SURVEYS_SUPABASE_URL: string;
    readonly VITE_APP_USERFLOW_KEY: string;
    readonly VITE_APP_POSTHOG_KEY: string;
    readonly VITE_APP_POSTHOG_API_HOST: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

/** Replaced in extracted library state by the publisher. */
declare const __WW_LIBRARY_CLASSES__: import('./pinia/entities').Registry<import('./pinia/entities').LibraryItem>;
