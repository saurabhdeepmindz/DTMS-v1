import type { BetterFetchOption } from '@better-fetch/fetch';
import type { AxiosInstance } from 'axios';
import type { EditorDragStore } from '@/_common/editor/store/editorDragStore';
import type { StoreRegistry } from '@/pinia/storeRegistry';

// Global type declarations for WeWeb

declare global {
    interface WwLib {
        editorDragStore: EditorDragStore;
        readonly store: StoreRegistry;
        readonly wwPluginHelper: typeof import('@/wwLib/services/wwPluginHelper').default;
        readonly wwCollection: typeof import('@/wwLib/services/wwCollection').default;
        readonly wwWebsiteData: typeof import('@/wwLib/services/wwWebsiteData').default;
        readonly currentBreakpoint: StoreRegistry['front']['activeScreenSize'];
        readonly breakpoints: StoreRegistry['front']['screenSizes'];
        [key: string]: any;
    }

    const wwLib: WwLib;
    const userflow: any;
    const wwAxios: AxiosInstance;
    type WwServerRequestOptions<T = unknown> = BetterFetchOption<
        unknown,
        Record<string, unknown>,
        Record<string, unknown> | Array<string> | undefined,
        T
    >;
    function wwServerClient<T = unknown>(url: string, options?: WwServerRequestOptions<T>): Promise<T>;
    interface Window {
        analytics: any;
        wwLib: typeof wwLib;
        userflow: typeof userflow;
        wwAxios: typeof wwAxios;
        wwServerClient: typeof wwServerClient;
        wwUsageTracker?: import('@/_common/helpers/usageTracking').UsageTracker;
    }
}

export {};
