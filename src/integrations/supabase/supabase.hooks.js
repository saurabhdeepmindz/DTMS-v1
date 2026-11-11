import { getSupabaseClient } from './supabase.utils.ts';

global.registerHook('auth-refresh', 'integration:supabase', async (c, { session, connection } = {}) => {
    if (!session?.access_token) return;

    const client = getSupabaseClient(connection?.config);
    const { data, error } = await client.auth.getUser(session.access_token);
    if (error) throw error;

    c.set('user', data.user);
});
