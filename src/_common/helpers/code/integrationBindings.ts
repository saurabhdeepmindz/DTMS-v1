export type IntegrationBindingSource<T> = {
    id: string;
    name?: string | null;
    integration: string;
    instance: T;
};

export type IntegrationConnectionIdentity = Pick<IntegrationBindingSource<unknown>, 'id' | 'name' | 'integration'>;

export function buildIntegrationConnectionLabels(sources: IntegrationConnectionIdentity[]): Map<string, string> {
    const labelCounts = new Map<string, number>();

    for (const source of sources) {
        const label = source.name || source.integration;
        labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }

    const labels = new Map<string, string>();
    for (const source of sources) {
        const label = source.name || source.integration;
        const displayLabel =
            labelCounts.get(label) === 1 ? label : `${label} (${source.integration} · ${source.id.slice(0, 8)})`;
        labels.set(source.id, displayLabel);
    }

    return labels;
}

function defineBinding<T>(bindings: Record<string, T>, key: string, instance: T) {
    Object.defineProperty(bindings, key, {
        value: instance,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

export function buildIntegrationBindings<T>(
    sources: IntegrationBindingSource<T>[],
    reservedAliases: readonly string[]
): Record<string, T> {
    const bindings: Record<string, T> = {};
    const connectionIds = new Set(sources.map(source => source.id));
    const reservedAliasSet = new Set(reservedAliases);
    const nameCounts = new Map<string, number>();
    const byIntegration = new Map<string, IntegrationBindingSource<T>[]>();

    for (const source of sources) {
        defineBinding(bindings, source.id, source.instance);

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
        if (connectionIds.has(source.name) || reservedAliasSet.has(source.name)) continue;
        defineBinding(bindings, source.name, source.instance);
    }

    for (const [integration, integrationSources] of byIntegration) {
        if (integrationSources.length !== 1 || connectionIds.has(integration)) continue;
        defineBinding(bindings, integration, integrationSources[0].instance);
    }

    return bindings;
}
