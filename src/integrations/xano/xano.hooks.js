import triggerCore from '../../core/trigger.core.js';

global.registerHook('auth-refresh', 'integration:xano', async (c, { session } = {}) => {
    await triggerCore.execute(
        'xano/auth-refresh',
        { session: session },
        { socketId: c.req.header('ww-socket-id'), editorUserId: c.req.header('ww-editor-user-id'), honoContext: c }
    );
});
