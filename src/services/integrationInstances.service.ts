import { getSupabaseClient } from '../integrations/supabase/supabase.utils.ts';
import { getXanoClient } from '../integrations/xano/xano.utils.ts';

type ResolvedConnection = { name?: string | null; integration: string; config: ConnectionConfig };
type ConnectionsContext = { connections?: Record<string, ResolvedConnection>; [key: string]: unknown };
type IntegrationBindingSource = {
    id: string;
    name?: string | null;
    integration: string;
    getInstance: () => unknown;
};

const CLIENT_FACTORIES: Record<string, (connection: ConnectionConfig) => unknown> = {
    supabase: getSupabaseClient,
    xano: getXanoClient,
};

function defineLazyInstance(target: Record<string, unknown>, key: string, getInstance: () => unknown) {
    Object.defineProperty(target, key, { get: getInstance, enumerable: true, configurable: true });
}

export function buildIntegrationBindings(context: ConnectionsContext) {
    const bindings: Record<string, unknown> = {};
    const connections = context?.connections || {};
    const sources: IntegrationBindingSource[] = [];

    for (const connectionId in connections) {
        const connection = connections[connectionId];
        const factory = CLIENT_FACTORIES[connection?.integration];
        if (!factory) continue;

        let instance: unknown;
        const getInstance = () => {
            if (!instance) instance = factory(connection.config);
            return instance;
        };

        sources.push({
            id: connectionId,
            name: connection.name,
            integration: connection.integration,
            getInstance,
        });
    }

    const connectionIds = new Set(sources.map(source => source.id));
    const reservedAliases = new Set(Object.keys(CLIENT_FACTORIES));
    const nameCounts = new Map<string, number>();
    const byIntegration = new Map<string, IntegrationBindingSource[]>();

    for (const source of sources) {
        defineLazyInstance(bindings, source.id, source.getInstance);

        if (source.name) {
            nameCounts.set(source.name, (nameCounts.get(source.name) || 0) + 1);
        }

        const integrationSources = byIntegration.get(source.integration) || [];
        integrationSources.push(source);
        byIntegration.set(source.integration, integrationSources);
    }

    for (const source of sources) {
        if (!source.name) continue;
        if (nameCounts.get(source.name) !== 1) continue;
        if (connectionIds.has(source.name) || reservedAliases.has(source.name)) continue;
        defineLazyInstance(bindings, source.name, source.getInstance);
    }

    for (const [integration, integrationSources] of byIntegration) {
        if (integrationSources.length !== 1 || connectionIds.has(integration)) continue;
        defineLazyInstance(bindings, integration, integrationSources[0].getInstance);
    }

    return bindings;
}
