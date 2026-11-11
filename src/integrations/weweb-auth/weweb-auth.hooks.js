import betterAuth from './better-auth.js';

global.registerHook('auth-refresh', 'integration:weweb-auth', async (c) => {
    const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
        c.set('user', null);
        c.set('session', null);
    } else {
        c.set('user', session.user);
        c.set('session', session.session);
    }
});

// Debug only: load a real user by id and set it as the authenticated context, to run a workflow
// "as a user" without a login. Real user (right shape), synthetic session (not persisted).
global.registerHook('auth-mock', 'integration:weweb-auth', async (c, { userId }) => {
    const ctx = await betterAuth.$context;
    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user) throw new Error(`User with ID "${userId}" not found`);
    c.set('user', user);
    c.set('session', { userId: user.id, impersonated: true });
});
