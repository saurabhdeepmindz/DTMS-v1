import triggerCore from '../../core/trigger.core.js';

global.registerHook('auth-refresh', 'integration:custom-auth', async (c, { session } = {}) => {
    await triggerCore.execute(
        'custom-auth/auth-refresh',
        { session: session },
        { socketId: c.req.header('ww-socket-id'), editorUserId: c.req.header('ww-editor-user-id'), honoContext: c }
    );
});
