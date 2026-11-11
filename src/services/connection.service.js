import { getEnv } from './env.service.ts';
import { getEditorRuntime } from './editorRuntime.service.ts';
import CONNECTIONS from '../data/connections.json' with { type: 'json' };

/**
 * The editor's live connections when it serves them, `fallback` otherwise: the packaged ones, or those a request
 * already carries.
 * @returns {import('./editorRuntime.service.ts').EditorRuntime['connections']}
 */
export function getConnections(fallback = CONNECTIONS) {
    return getEditorRuntime()?.connections ?? fallback;
}

export function resolveConnections(connections, options = {}) {
    const resolved = {};
    for (const connectionId in connections || {}) {
        resolved[connectionId] = resolveConnection(connections[connectionId], options);
    }
    return resolved;
}

export function resolveConnection(connection, options = {}) {
    if (!connection) return null;
    return { ...connection, config: resolveConnectionConfig(connection.config, options) };
}

export function resolveConnectionConfig(connectionConfig, options = {}) {
    if (!connectionConfig) return null;
    const config = {};
    for (const key in connectionConfig) {
        config[key] = getConfigEnvVariableValue(connectionConfig, key, options);
    }
    return config;
}

function getConfigEnvVariableValue(config, key, options = {}) {
    if (!config[key]?.__envVariableKey) return config[key];
    return getEnv(config[key].__envVariableKey, options.env || 'current');
}

export default {
    resolveConnections,
    resolveConnectionConfig,
    getConfigEnvVariableValue,
};
