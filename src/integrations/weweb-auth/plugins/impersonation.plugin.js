import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

export const impersonationPlugin = () => {
    return {
        id: 'impersonation',
        endpoints: {
            impersonate: createAuthEndpoint('/impersonate', { method: 'POST' }, async ctx => {
                try {
                    const { userId } = await ctx.body;

                    if (!userId) {
                        return ctx.json({ error: 'User ID is required' }, 400);
                    }

                    const targetUser = await ctx.context.internalAdapter.findUserById(userId);
                    if (!targetUser) {
                        return ctx.json({ error: 'User not found' }, 404);
                    }

                    const session = await ctx.context.internalAdapter.createSession(targetUser.id, ctx);
                    if (!session) {
                        return ctx.json({ error: 'Failed to create impersonation session' }, 500);
                    }

                    await setSessionCookie(
                        ctx,
                        {
                            session: session,
                            user: targetUser,
                        },
                        false
                    );

                    return ctx.json({
                        session: session,
                        user: targetUser,
                    });
                } catch (error) {
                    return ctx.json({ error: error.message }, 500);
                }
            }),
        },
    };
};
