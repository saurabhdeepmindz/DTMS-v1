import type { MiddlewareHandler } from 'hono';
import { PublicHTTPException } from '../core/http.errors.ts';
import wewebService from '../services/weweb.service.js';
import { isEditorRuntimeEnabled } from '../services/editorRuntime.service.ts';

export const loadEditorRuntime: MiddlewareHandler = async (c, next) => {
    if (!isEditorRuntimeEnabled()) {
        return next();
    }
    if (c.get('editorRuntime')) return next();

    try {
        const runtime = await wewebService.getEditorRuntime({
            socketId: c.req.header('ww-socket-id'),
            editorUserId: c.req.header('ww-editor-user-id'),
        });
        c.set('editorRuntime', runtime);
    } catch {
        throw new PublicHTTPException(
            503,
            'Unable to load current editor environment variables and connections. Please retry.',
            {
                code: 'EDITOR_RUNTIME_UNAVAILABLE',
            }
        );
    }

    return next();
};
