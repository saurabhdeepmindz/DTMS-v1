import { executeWorkflows } from '@/_common/helpers/data/workflows.js';
export default {
    hooks: {
        'auth-refresh': async ({ session } = {}) => {
            await executeWorkflows('custom-auth/auth-refresh', { event: { session } });
        },
    },
    actions: {
        'auth-set-user': async ({ args }) => {
            const backAuthStore = wwLib.store.backAuth;
            await backAuthStore.setAuthUser(args.user);
        },
        'auth-set-session': async ({ args }) => {
            const backAuthStore = wwLib.store.backAuth;
            await backAuthStore.setAuthSession(
                {
                    accessToken: args.accessToken,
                    refreshToken: args.refreshToken,
                    metadata: args.metadata,
                },
                {
                    persist: args.persist,
                    refresh: true,
                }
            );
        },
        'auth-clear-session': async () => {
            const backAuthStore = wwLib.store.backAuth;
            await backAuthStore.clearAuthSession();
        },
    },
};
