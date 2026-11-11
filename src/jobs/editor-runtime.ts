import { originalEnv } from '../core/env.core.js';

// Environment acquisition and attempt execution must agree on whether packaged configuration is authoritative.
export function usesLiveEditorRuntime() {
    return (
        (process.env.ENV || originalEnv.ENV || 'editor') === 'editor' &&
        process.env.WEWEB_JOBS_SELF_HOSTED !== 'true' &&
        !(process.env.WEWEB_ENV === 'local' && process.env.NODE_ENV === 'production')
    );
}
