import { betterAuth } from 'better-auth';
import { magicLink, emailOTP } from 'better-auth/plugins';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { impersonationPlugin } from './plugins/impersonation.plugin.js';
import databaseService from '../../services/database/database.service.ts';
import {
    addCallbackTicket,
    getAppAccessConfig,
    getAppAccessUserInfo,
    getGroupRoles,
    getUserSubject,
    isAllowed,
    isInternal,
    registerAppAccessAuth,
} from '../../core/appAccess.core.ts';
import triggerCore from '../../core/trigger.core.js';
import { getAppUrls, getTrustedOrigins, isDevelopment } from '../../core/config.core.js';
import authUsersColumns from '../../data/authUsersColumns.json' with { type: 'json' };
import { WEWEB_USER_KEYS } from './userData.ts';

// Columns built into better-auth's user schema — handled natively, not via additionalFields
const BASE_USER_COLUMNS = new Set(['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt']);

// Normalized types come from formatColumn() in weweb-back's database.core.js.
// Maps to better-auth types: 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]'
const NORMALIZED_TYPE_TO_BETTERAUTH = {
    text: 'string',
    uuid: 'string',
    bigint: 'number',
    integer: 'number',
    smallint: 'number',
    numeric: 'number',
    'double precision': 'number',
    real: 'number',
    boolean: 'boolean',
    date: 'date',
    timestamp: 'date',
    'timestamp without time zone': 'date',
    'timestamp with time zone': 'date',
    jsonb: 'string',
    json: 'string',
};

function mapNormalizedTypeToBetterAuth(type) {
    if (typeof type === 'string' && type.endsWith('[]')) {
        const base = NORMALIZED_TYPE_TO_BETTERAUTH[type.slice(0, -2)] || 'string';
        return base === 'number' ? 'number[]' : 'string[]';
    }
    return NORMALIZED_TYPE_TO_BETTERAUTH[type] || 'string';
}

// `roles` is always exposed but never settable from user input (admin-managed).
const ROLES_FIELD = {
    type: 'array',
    required: false,
    defaultValue: null,
    input: false,
};

function buildAdditionalFields() {
    const fields = { roles: ROLES_FIELD };
    for (const col of authUsersColumns.columns || []) {
        if (BASE_USER_COLUMNS.has(col.name)) continue;
        if (col.name === 'roles') continue;
        fields[col.name] = {
            type: mapNormalizedTypeToBetterAuth(col.type),
            // NOT NULL is required from better-auth's perspective only if Postgres won't auto-fill it.
            required: col.isRequired === true && !col.defaultValue,
            // WeWeb's, for an internal app's directory and grants: never set by the user.
            ...(WEWEB_USER_KEYS.includes(col.name) ? { input: false } : {}),
        };
    }
    return fields;
}

const additionalFields = buildAdditionalFields();

const plugins = [
    magicLink({
        sendMagicLink: async ({ email, token, url, metadata }, ctx) => {
            await triggerCore.execute(
                'weweb-auth/request-magic-link',
                { email, token, url, metadata },
                {
                    socketId: ctx?.request?.headers?.get?.('ww-socket-id'),
                    editorUserId: ctx?.request?.headers?.get?.('ww-editor-user-id'),
                }
            );
        },
    }),
    emailOTP({
        async sendVerificationOTP({ email, otp, type }, ctx) {
            await triggerCore.execute(
                'weweb-auth/request-otp',
                { email, otp, type },
                {
                    socketId: ctx?.request?.headers?.get?.('ww-socket-id'),
                    editorUserId: ctx?.request?.headers?.get?.('ww-editor-user-id'),
                }
            );
        },
    }),
];

const hooks = {
    before: createAuthMiddleware(async ctx => {
        if (ctx.path.startsWith('/sign-up')) {
            await triggerCore.execute(
                'weweb-auth/before-sign-up',
                { payload: ctx.body },
                { socketId: ctx.headers?.get?.('ww-socket-id'), editorUserId: ctx.headers?.get?.('ww-editor-user-id') }
            );
        }
    }),
    after: createAuthMiddleware(async ctx => {
        if (ctx.path.startsWith('/sign-in')) {
            const session = ctx.context.session || ctx.context.newSession;
            if (session) {
                const methodMatch = ctx.path.match(/^\/sign-in\/([^/]+)/);
                const method = methodMatch?.[1] || 'unknown';
                const provider = method === 'social' ? ctx.body?.provider : null;
                await triggerCore.execute(
                    'weweb-auth/after-sign-in',
                    { user: session.user, method, provider },
                    {
                        socketId: ctx.headers?.get?.('ww-socket-id'),
                        editorUserId: ctx.headers?.get?.('ww-editor-user-id'),
                    }
                );
            }
        } else if (ctx.path.startsWith('/callback/')) {
            const provider = ctx.params?.id;
            const session = ctx.context.session || ctx.context.newSession;
            if (session) {
                await triggerCore.execute(
                    'weweb-auth/after-sign-in',
                    { user: session.user, method: 'social', provider },
                    {
                        socketId: ctx.headers?.get?.('ww-socket-id'),
                        editorUserId: ctx.headers?.get?.('ww-editor-user-id'),
                    }
                );
            }
        } else if (ctx.path === '/magic-link/verify') {
            const session = ctx.context.newSession;
            if (session) {
                await triggerCore.execute(
                    'weweb-auth/after-sign-in',
                    { user: session.user, method: 'magic-link', provider: null },
                    {
                        socketId: ctx.headers?.get?.('ww-socket-id'),
                        editorUserId: ctx.headers?.get?.('ww-editor-user-id'),
                    }
                );
            }
        } else if (ctx.path === '/change-password') {
            // Only trigger if successful (no error statusCode) and user exists
            const isError = ctx.context.returned?.statusCode >= 400;
            const user = ctx.context.session?.user;
            if (!isError && user) {
                await triggerCore.execute(
                    'weweb-auth/password-updated',
                    { user },
                    {
                        socketId: ctx.headers?.get?.('ww-socket-id'),
                        editorUserId: ctx.headers?.get?.('ww-editor-user-id'),
                    }
                );
            }
        }
    }),
};

const appUrls = getAppUrls().filter(Boolean);

const buildCognitoProvider = () => {
    if (process.env.PROVIDER_COGNITO_ENABLED !== 'TRUE') return undefined;
    const clientId = process.env.PROVIDER_COGNITO_CLIENT_ID;
    const clientSecret = process.env.PROVIDER_COGNITO_CLIENT_SECRET;
    const domainUrl = process.env.PROVIDER_COGNITO_ISSUER;
    const userPoolId = process.env.PROVIDER_COGNITO_USER_POOL_ID;
    // AWS user pool ids are always "<region>_<id>" — the region comes from there, never from the domain (custom domains allowed)
    const region = userPoolId?.includes('_') ? userPoolId.split('_')[0] : undefined;
    if (!clientId || !clientSecret || !domainUrl || !userPoolId || !region) {
        console.warn('[weweb-auth] Cognito provider disabled — incomplete configuration.');
        return undefined;
    }
    let domain;
    try {
        domain = new URL(domainUrl.includes('://') ? domainUrl : `https://${domainUrl}`).hostname;
    } catch {
        console.warn('[weweb-auth] Cognito provider disabled — domain is not a valid URL.');
        return undefined;
    }
    return { clientId, clientSecret, domain, region, userPoolId };
};

// Internal apps (APP_ACCESS=internal): only the people granted the app sign in, with the workspace's
// Google or Microsoft client, and nothing else. Sessions last 12 hours without renewal: the next
// sign-in at the provider refuses a suspended company account. Their groups granted the app are their roles.
const withAppAccess = options => {
    if (!isInternal()) return options;

    const { provider, clientId, clientSecret, tenantId, callbackUrl, callbackTickets } = getAppAccessConfig();
    // Through the callback the workspace's apps share, registered once on its client, when WeWeb set one up.
    const useSharedCallback = !!callbackUrl && Object.keys(callbackTickets).length > 0;
    return {
        ...options,
        plugins: useSharedCallback ? [sharedCallbackPlugin()] : [],
        emailAndPassword: { enabled: false },
        socialProviders: provider
            ? {
                  [provider]: {
                      clientId,
                      clientSecret,
                      ...(provider === 'microsoft' ? { tenantId } : {}),
                      // The sign-in link and the code exchange both use it.
                      ...(useSharedCallback ? { redirectURI: callbackUrl } : {}),
                      // Redirect flow only: the ID token then comes from the provider's token endpoint.
                      disableIdTokenSignIn: true,
                      getUserInfo: getAppAccessUserInfo,
                  },
              }
            : {},
        databaseHooks: {
            ...options.databaseHooks,
            session: {
                create: {
                    // Sign-in already checked the access: this covers a removal in between, and any other path.
                    before: async (session, ctx) => {
                        try {
                            const internalAdapter = ctx?.context?.internalAdapter;
                            const subject = await getUserSubject(internalAdapter, session.userId);
                            if (!(await isAllowed(subject))) return false;
                            await internalAdapter.updateUser(session.userId, { roles: await getGroupRoles(subject) });
                            return;
                        } catch (error) {
                            console.error('[app-access] Unable to check the access', error);
                        }
                        return false;
                    },
                },
            },
        },
        session: { ...options.session, expiresIn: 60 * 60 * 12, disableSessionRefresh: true },
        // Starting a sign-in only sends people to the provider, which checks them: better-auth's 3 per 10 seconds by
        // address would stop colleagues behind the company's one opening the app together. Each stores a state.
        rateLimit: {
            ...options.rateLimit,
            customRules: { ...options.rateLimit?.customRules, '/sign-in/social': { window: 10, max: 30 } },
        },
        onAPIError: { ...options.onAPIError, errorURL: '/api/ww/access/denied' },
    };
};

// The shared callback sends people on to the app their sign-in link names: this one, at the address they signed in
// from. An address without a ticket can't sign in through it.
const sharedCallbackPlugin = () => ({
    id: 'app-access-shared-callback',
    hooks: {
        after: [
            {
                matcher: ctx => ctx.path === '/sign-in/social',
                handler: createAuthMiddleware(async ctx => {
                    const returned = ctx.context.returned;
                    if (typeof returned?.url !== 'string') return;
                    const origin = new URL(ctx.context.baseURL).origin;
                    const url = addCallbackTicket(returned.url, origin);
                    if (!url) {
                        console.error('[app-access] No sign-in ticket for', origin);
                        throw new APIError('FORBIDDEN', { code: 'APP_ACCESS_UNKNOWN_ADDRESS', message: 'This address cannot sign in.' });
                    }
                    return ctx.json({ ...returned, url });
                }),
            },
        ],
    },
});

const createAuth = options => {
    const auth = betterAuth(withAppAccess(options));
    registerAppAccessAuth(auth);
    return auth;
};

export default databaseService.pool && process.env.AUTH_SECRET
    ? createAuth({
          database: databaseService.pool,
          trustedOrigins: getTrustedOrigins,
          secret: process.env.AUTH_SECRET,
          // OAuth redirect_uri and cookies must follow the host the browser used (custom domains).
          baseURL: {
              allowedHosts: [...appUrls.map(url => new URL(url).host), ...(isDevelopment() ? ['localhost:*'] : [])],
              fallback: appUrls[0] || process.env.SERVER_URL,
          },
          basePath: '/api/auth',
          plugins: process.env.ENV === 'editor' ? [...plugins, impersonationPlugin()] : plugins,
          hooks: hooks,
          databaseHooks: {
              user: {
                  create: {
                      after: async (user, ctx) => {
                          let method = 'unknown';
                          let provider = null;
                          const path = ctx?.path;
                          if (path?.startsWith('/sign-up/')) {
                              const methodMatch = path.match(/^\/sign-up\/([^/]+)/);
                              method = methodMatch?.[1] || 'email';
                          } else if (path?.startsWith('/callback/')) {
                              method = 'social';
                              provider = ctx?.params?.id;
                          } else if (path === '/magic-link/verify') {
                              method = 'magic-link';
                          }
                          await triggerCore.execute(
                              'weweb-auth/after-sign-up',
                              { user, method, provider },
                              {
                                  socketId: ctx?.headers?.get?.('ww-socket-id'),
                                  editorUserId: ctx?.headers?.get?.('ww-editor-user-id'),
                              }
                          );
                      },
                  },
              },
          },
          advanced: {
              cookiePrefix: 'ww-app-auth',
              defaultCookieAttributes: {
                  sameSite: 'none',
                  secure: true,
                  // !Issue when set to true when using google and the lambda is deployed
                  // partitioned: true,
              },
              crossSubdomainCookies: {
                  enabled: true,
                  domain: process.env.APP_URL,
              },
              useSecureCookies: true,
              database: {
                  generateId: false,
              },
          },
          user: {
              modelName: 'auth.users',
              additionalFields,
          },
          session: {
              modelName: 'auth.sessions',
              expiresIn: 60 * 60 * 24 * 7, // 7 days
          },
          account: { modelName: 'auth.accounts' },
          verification: { modelName: 'auth.verifications' },
          emailVerification: {
              sendVerificationEmail: async ({ user, url, token }, ctx) => {
                  await triggerCore.execute(
                      'weweb-auth/request-email-verification',
                      { user, url, token },
                      {
                          socketId: ctx.request?.headers?.get?.('ww-socket-id'),
                          editorUserId: ctx.request?.headers?.get?.('ww-editor-user-id'),
                      }
                  );
              },
          },
          emailAndPassword: {
              enabled: process.env.PROVIDER_EMAIL_ENABLED === 'TRUE',
              requireEmailVerification: process.env.PROVIDER_EMAIL_VERIFICATION_ENABLED === 'TRUE',
              disableSignUp: process.env.PROVIDER_EMAIL_DISABLE_SIGNUP === 'TRUE',
              sendResetPassword: async ({ user, url, token }, ctx) => {
                  await triggerCore.execute(
                      'weweb-auth/request-password-reset',
                      { user, url, token },
                      {
                          socketId: ctx.request?.headers?.get?.('ww-socket-id'),
                          editorUserId: ctx.request?.headers?.get?.('ww-editor-user-id'),
                      }
                  );
              },
              onPasswordReset: async ({ user }, ctx) => {
                  await triggerCore.execute(
                      'weweb-auth/password-updated',
                      { user },
                      {
                          socketId: ctx.request?.headers?.get?.('ww-socket-id'),
                          editorUserId: ctx.request?.headers?.get?.('ww-editor-user-id'),
                      }
                  );
              },
              minPasswordLength: process.env.PROVIDER_EMAIL_PASSWORD_MIN_LENGTH || 8,
              resetPasswordTokenExpiresIn: parseInt(
                  process.env.PROVIDER_EMAIL_RESET_PASSWORD_TOKEN_EXPIRES_IN || '3600',
                  10
              ),
          },
          socialProviders: {
              apple:
                  process.env.PROVIDER_APPLE_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_APPLE_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_APPLE_CLIENT_SECRET,
                            appBundleIdentifier: process.env.PROVIDER_APPLE_APP_BUNDLE_IDENTIFIER,
                        }
                      : undefined,
              discord:
                  process.env.PROVIDER_DISCORD_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_DISCORD_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_DISCORD_CLIENT_SECRET,
                        }
                      : undefined,
              facebook:
                  process.env.PROVIDER_FACEBOOK_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_FACEBOOK_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_FACEBOOK_CLIENT_SECRET,
                        }
                      : undefined,
              github:
                  process.env.PROVIDER_GITHUB_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_GITHUB_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_GITHUB_CLIENT_SECRET,
                        }
                      : undefined,
              google:
                  process.env.PROVIDER_GOOGLE_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_GOOGLE_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_GOOGLE_CLIENT_SECRET,
                        }
                      : undefined,
              huggingface:
                  process.env.PROVIDER_HUGGINGFACE_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_HUGGINGFACE_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_HUGGINGFACE_CLIENT_SECRET,
                        }
                      : undefined,
              kick:
                  process.env.PROVIDER_KICK_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_KICK_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_KICK_CLIENT_SECRET,
                        }
                      : undefined,
              microsoft:
                  process.env.PROVIDER_MICROSOFT_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_MICROSOFT_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_MICROSOFT_CLIENT_SECRET,
                            tenantId: process.env.PROVIDER_MICROSOFT_TENANT_ID,
                            prompt: process.env.PROVIDER_MICROSOFT_PROMPT,
                        }
                      : undefined,
              slack:
                  process.env.PROVIDER_SLACK_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_SLACK_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_SLACK_CLIENT_SECRET,
                        }
                      : undefined,
              notion:
                  process.env.PROVIDER_NOTION_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_NOTION_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_NOTION_CLIENT_SECRET,
                        }
                      : undefined,
              tiktok:
                  process.env.PROVIDER_TIKTOK_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_TIKTOK_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_TIKTOK_CLIENT_SECRET,
                            clientKey: process.env.PROVIDER_TIKTOK_CLIENT_KEY,
                        }
                      : undefined,
              twitch:
                  process.env.PROVIDER_TWITCH_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_TWITCH_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_TWITCH_CLIENT_SECRET,
                        }
                      : undefined,
              twitter:
                  process.env.PROVIDER_TWITTER_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_TWITTER_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_TWITTER_CLIENT_SECRET,
                        }
                      : undefined,
              dropbox:
                  process.env.PROVIDER_DROPBOX_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_DROPBOX_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_DROPBOX_CLIENT_SECRET,
                        }
                      : undefined,
              linear:
                  process.env.PROVIDER_LINEAR_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_LINEAR_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_LINEAR_CLIENT_SECRET,
                        }
                      : undefined,
              linkedin:
                  process.env.PROVIDER_LINKEDIN_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_LINKEDIN_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_LINKEDIN_CLIENT_SECRET,
                        }
                      : undefined,
              gitlab:
                  process.env.PROVIDER_GITLAB_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_GITLAB_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_GITLAB_CLIENT_SECRET,
                            issuer: process.env.PROVIDER_GITLAB_ISSUER,
                        }
                      : undefined,
              reddit:
                  process.env.PROVIDER_REDDIT_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_REDDIT_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_REDDIT_CLIENT_SECRET,
                        }
                      : undefined,
              roblox:
                  process.env.PROVIDER_ROBLOX_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_ROBLOX_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_ROBLOX_CLIENT_SECRET,
                        }
                      : undefined,
              spotify:
                  process.env.PROVIDER_SPOTIFY_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_SPOTIFY_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_SPOTIFY_CLIENT_SECRET,
                        }
                      : undefined,
              vk:
                  process.env.PROVIDER_VK_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_VK_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_VK_CLIENT_SECRET,
                        }
                      : undefined,
              zoom:
                  process.env.PROVIDER_ZOOM_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_ZOOM_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_ZOOM_CLIENT_SECRET,
                        }
                      : undefined,
              atlassian:
                  process.env.PROVIDER_ATLASSIAN_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_ATLASSIAN_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_ATLASSIAN_CLIENT_SECRET,
                        }
                      : undefined,
              cognito: buildCognitoProvider(),
              figma:
                  process.env.PROVIDER_FIGMA_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_FIGMA_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_FIGMA_CLIENT_SECRET,
                        }
                      : undefined,
              kakao:
                  process.env.PROVIDER_KAKAO_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_KAKAO_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_KAKAO_CLIENT_SECRET,
                        }
                      : undefined,
              line:
                  process.env.PROVIDER_LINE_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_LINE_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_LINE_CLIENT_SECRET,
                        }
                      : undefined,
              naver:
                  process.env.PROVIDER_NAVER_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_NAVER_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_NAVER_CLIENT_SECRET,
                        }
                      : undefined,
              paypal:
                  process.env.PROVIDER_PAYPAL_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_PAYPAL_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_PAYPAL_CLIENT_SECRET,
                        }
                      : undefined,
              polar:
                  process.env.PROVIDER_POLAR_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_POLAR_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_POLAR_CLIENT_SECRET,
                        }
                      : undefined,
              salesforce:
                  process.env.PROVIDER_SALESFORCE_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_SALESFORCE_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_SALESFORCE_CLIENT_SECRET,
                        }
                      : undefined,
              vercel:
                  process.env.PROVIDER_VERCEL_ENABLED === 'TRUE'
                      ? {
                            clientId: process.env.PROVIDER_VERCEL_CLIENT_ID,
                            clientSecret: process.env.PROVIDER_VERCEL_CLIENT_SECRET,
                        }
                      : undefined,
          },
      })
    : null;
