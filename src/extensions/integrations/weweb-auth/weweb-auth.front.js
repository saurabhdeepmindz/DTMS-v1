import { createAuthClient } from 'better-auth/client';
import { magicLinkClient, emailOTPClient } from 'better-auth/client/plugins';
import { getServerUrl } from '@/_common/helpers/code/backendWorkflows.js';
/* wwFront:start */
import { goToAppAccessSignedOut } from '@/_common/helpers/code/appAccessRedirects';
/* wwFront:end */
 
function getPageUrl(pageConfig = {}) {
    if (pageConfig.type === 'internal') {
        const pageId = pageConfig.pageId;
        return wwLib.manager
            ? `${window.location.origin}/${pageId}`
            : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
    } else {
        return pageConfig.url;
    }
}

export default {
    init: async () => {
        return createAuthClient({
            baseURL: getServerUrl(),
            plugins: [magicLinkClient(), emailOTPClient()],
            basePath: '/api/auth',
            fetchOptions: {
                credentials: 'include',
                retry: {
                    type: 'linear',
                    attempts: 20,
                    delay: 100,
                    shouldRetry: response => {
                        if (response.status === 429) return true;
                        return false;
                    },
                },
             },
        });
    },
    hooks: {
        'auth-refresh': async ({ instance } = {}) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const backAuthStore = wwLib.store.backAuth;

            try {
                const { data, error } = await instance.getSession();
                if (error) {
                    throw error;
                } else {
                    backAuthStore.session = data?.session;
                    backAuthStore.user = data?.user;
                }
            } catch (error) {
                wwLib.wwLog.error(error);
                backAuthStore.session = null;
                backAuthStore.user = null;
            }
        },
    },
    actions: {
        'signin-email': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, password, rememberMe } = args;
            const { data, error } = await instance.signIn.email({
                email,
                password,
                rememberMe: rememberMe !== false, // Default to true
            });

            if (error) throw error;

            const backAuthStore = wwLib.store.backAuth;
            await backAuthStore.refresh();

            return data;
        },
        'signup-email': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, password, displayName, image, redirectURL } = args;
            const { data, error } = await instance.signUp.email({
                email,
                password,
                name: displayName || email,
                image,
                ...(redirectURL ? { callbackURL: getPageUrl(redirectURL) } : {}),
            });

            if (error) throw error;

            const backAuthStore = wwLib.store.backAuth;
            await backAuthStore.refresh();

            return data;
        },
        'signin-social': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { provider, disableRedirect, successPageId, errorPageId, newUserPageId } = args;

            let callbackURL = null;
            let errorCallbackURL = null;
            let newUserCallbackURL = null;

            if (successPageId) {
                const pageId = typeof successPageId === 'object' ? successPageId.pageId : successPageId;
                callbackURL = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            }

            if (errorPageId) {
                const pageId = typeof errorPageId === 'object' ? errorPageId.pageId : errorPageId;
                errorCallbackURL = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            }

            if (newUserPageId) {
                const pageId = typeof newUserPageId === 'object' ? newUserPageId.pageId : newUserPageId;
                newUserCallbackURL = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            }

            const { data, error } = await instance.signIn.social({
                provider,
                ...(callbackURL ? { callbackURL } : {}),
                ...(errorCallbackURL ? { errorCallbackURL } : {}),
                ...(newUserCallbackURL ? { newUserCallbackURL } : {}),
                disableRedirect: disableRedirect || false,
            });

            if (error) throw error;

            const backAuthStore = wwLib.store.backAuth;
            await backAuthStore.refresh();

            return data;
        },
        signout: async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            /* wwFront:start */
            if (window.wwg_designInfo?.auth?.appAccess === 'internal') {
                await instance.signOut();
                goToAppAccessSignedOut();
                // The page is leaving: what the workflow does next (going to a page, its own login page...) would sign
                // the person back in.
                return new Promise(() => {});
            }
            /* wwFront:end */
            const result = await instance.signOut({
                fetchOptions: {
                    onSuccess: () => {
                        if (args?.redirectURL) {
                            window.location.href = args.redirectURL;
                        }
                    },
                },
            });

            const backAuthStore = wwLib.store.backAuth;
            backAuthStore.setAuthUser(null);
            backAuthStore.setAuthSession(null);

            return result;
        },
        'verify-email': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, redirectURL } = args;

            let redirectUrl = window.location.origin;
            if (redirectURL?.type === 'internal') {
                const pageId = redirectURL.pageId;
                redirectUrl = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            } else if (redirectURL?.url) {
                redirectUrl = redirectURL.url;
            }

            const { data, error } = await instance.sendVerificationEmail({
                email,
                callbackURL: redirectUrl,
            });

            if (error) throw error;

            return data;
        },
        'request-reset-password': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, redirectURL } = args;

            let redirectUrl = window.location.origin;
            if (redirectURL?.type === 'internal') {
                const pageId = redirectURL.pageId;
                redirectUrl = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            } else if (redirectURL?.url) {
                redirectUrl = redirectURL.url;
            }

            const { data, error } = await instance.requestPasswordReset({
                email,
                redirectTo: redirectUrl,
            });

            if (error) throw error;

            return data;
        },
        'update-password': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { currentPassword, newPassword } = args;
            const { data, error } = await instance.changePassword({
                currentPassword,
                newPassword,
            });

            if (error) throw error;

            return data;
        },
        'reset-password': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const token = args.token || new URLSearchParams(window.location.search).get('token');
            const { data, error } = await instance.resetPassword({
                newPassword: args.newPassword,
                token,
            });

            if (error) throw error;

            return data;
        },
        'request-magic-link': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, name, redirectURL, newUserRedirectURL, errorRedirectURL, metadata } = args;

            let callbackURL = null;
            let newUserCallbackURL = null;
            let errorCallbackURL = null;

            if (redirectURL && redirectURL.type === 'internal') {
                const pageId = redirectURL.pageId;
                callbackURL = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            } else if (redirectURL && redirectURL.type === 'external') {
                callbackURL = redirectURL.url;
            }

            if (newUserRedirectURL && newUserRedirectURL.type === 'internal') {
                const pageId = newUserRedirectURL.pageId;
                newUserCallbackURL = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            } else if (newUserRedirectURL && newUserRedirectURL.type === 'external') {
                newUserCallbackURL = newUserRedirectURL.url;
            }

            if (errorRedirectURL && errorRedirectURL.type === 'internal') {
                const pageId = errorRedirectURL.pageId;
                errorCallbackURL = wwLib.manager
                    ? `${window.location.origin}/${pageId}`
                    : `${window.location.origin}${wwLib.wwPageHelper.getPagePath(pageId)}`;
            } else if (errorRedirectURL && errorRedirectURL.type === 'external') {
                errorCallbackURL = errorRedirectURL.url;
            }

            const { data, error } = await instance.signIn.magicLink({
                email,
                name,
                callbackURL,
                newUserCallbackURL,
                errorCallbackURL,
                metadata,
            });

            if (error) throw error;

            return data;
        },
        'request-otp': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, type } = args;
            const { data, error } = await instance.emailOtp.sendVerificationOtp({
                email,
                type: type || 'sign-in',
            });

            if (error) throw error;

            return data;
        },
        'check-verification-otp': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, otp, type } = args;
            const { data, error } = await instance.emailOtp.checkVerificationOtp({
                email,
                otp,
                type: type || 'sign-in',
            });

            if (!error) {
                const backAuthStore = wwLib.store.backAuth;
                await backAuthStore.refresh();
            }

            if (error) throw error;

            return data;
        },
        'signin-otp': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, otp } = args;
            const { data, error } = await instance.signIn.emailOtp({
                email,
                otp,
            });

            if (!error) {
                const backAuthStore = wwLib.store.backAuth;
                await backAuthStore.refresh();
            }

            if (error) throw error;

            return data;
        },
        'verify-email-otp': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, otp } = args;
            const { data, error } = await instance.emailOtp.verifyEmail({
                email,
                otp,
            });

            if (error) throw error;

            return data;
        },
        'reset-password-otp': async ({ args }, { instance }) => {
            if (!instance) throw new Error('WeWeb Auth instance is required');
            const { email, otp, password } = args;
            const { data, error } = await instance.emailOtp.resetPassword({
                email,
                otp,
                password,
            });

            if (error) throw error;

            return data;
        },
    },
};
