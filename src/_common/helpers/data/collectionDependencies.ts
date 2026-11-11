type Resource = { id: string; [key: string]: unknown };

/** Resolve the page's transitive dependencies without repeatedly serializing its closure. */
export function collectPageCollections<T extends Resource>({
    page,
    websiteWorkflows,
    collections,
    workflows,
    formulas,
    libraryComponents,
    getComponentElements,
}: {
    page: unknown;
    websiteWorkflows: unknown;
    collections: T[];
    workflows: Resource[];
    formulas: Resource[];
    libraryComponents: Resource[];
    getComponentElements: (id: string) => unknown;
}): T[] {
    const resources = new Map<string, Resource[]>();
    for (const resource of [...collections, ...workflows, ...formulas, ...libraryComponents]) {
        const entries = resources.get(resource.id) || [];
        entries.push(resource);
        resources.set(resource.id, entries);
    }
    if (!resources.size) return [];

    // References also occur inside formulas and custom code. Keep the previous substring
    // semantics, including overlapping IDs, instead of assuming a particular binding shape.
    const ids = [...resources.keys()].sort((left, right) => right.length - left.length);
    const prefixes = new Map(ids.map(id => [id, ids.filter(candidate => id.startsWith(candidate))]));
    const references = new RegExp(`(?=(${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g');
    const components = new Set(libraryComponents.map(component => component.id));
    const visited = new Set<string>();
    const pending: string[] = [];
    const visit = (value: unknown) => {
        const serialized = JSON.stringify(value);
        if (!serialized) return;
        for (const match of serialized.matchAll(references)) {
            for (const id of prefixes.get(match[1])!) {
                if (visited.has(id)) continue;
                visited.add(id);
                pending.push(id);
            }
        }
    };

    visit(page);
    visit(websiteWorkflows);
    for (let index = 0; index < pending.length; index++) {
        const id = pending[index];
        for (const resource of resources.get(id)!) visit(resource);
        if (components.has(id)) visit(getComponentElements(id));
    }
    return collections.filter(collection => visited.has(collection.id));
}
