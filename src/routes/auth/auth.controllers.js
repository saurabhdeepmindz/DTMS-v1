import { setSignedCookie, deleteCookie } from 'hono/cookie';

export const setSession = async c => {
    const { session } = await c.req.json();
    await setSignedCookie(c, 'ww-app-session', JSON.stringify(session || {}), process.env.AUTH_SECRET, {
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
        maxAge: 60 * 60 * 24 * 365, // 1 year
        prefix: 'secure',
    });
    return c.json({ message: 'Authenticated' }, 200);
};

export const removeSession = async c => {
    await deleteCookie(c, 'ww-app-session', {
        prefix: 'secure',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
    });
    return c.json({ message: 'Disconnected' }, 200);
};
