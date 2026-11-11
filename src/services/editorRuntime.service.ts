import { tryGetContext } from 'hono/context-storage';
import { AsyncLocalStorage } from 'node:async_hooks';

export type EditorRuntime = {
    envVariables: Record<'editor' | 'staging' | 'production', Record<string, string | undefined>>;
    connections: Record<string, { id: string; name?: string; integration: string; config: ConnectionConfig }>;
};

const attemptRuntime = new AsyncLocalStorage<EditorRuntime>();

export function isEditorRuntimeEnabled(): boolean {
    return (
        process.env.ENV === 'editor' && !(process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production')
    );
}

export function runWithEditorRuntime<T>(runtime: EditorRuntime, execute: () => T): T {
    return attemptRuntime.run(runtime, execute);
}

export function getEditorRuntime(): EditorRuntime | undefined {
    return (
        attemptRuntime.getStore() ||
        tryGetContext<{ Variables: { editorRuntime: EditorRuntime } }>()?.get('editorRuntime')
    );
}
