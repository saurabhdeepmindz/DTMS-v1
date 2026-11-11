type Environment = 'editor' | 'staging' | 'production';

type EnvironmentVariable = {
    name: string;
    editorValue?: unknown;
    stagingValue?: unknown;
    productionValue?: unknown;
};

export function createEnvironmentVariablesContext(
    environmentVariables: EnvironmentVariable[],
    environment: Environment
): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const environmentVariable of environmentVariables) {
        const { name } = environmentVariable;
        values[name] = environmentVariable[`${environment}Value`];
    }

    return createCaseInsensitiveObject(values);
}

export function createCaseInsensitiveObject<T>(values: Record<string, T>): Record<string, T | undefined> {
    const namesByCanonicalName = new Map<string, string | null>();

    for (const name in values) {
        const canonicalName = name.toUpperCase();
        const existingName = namesByCanonicalName.get(canonicalName);
        if (existingName === undefined) {
            namesByCanonicalName.set(canonicalName, name);
        } else if (existingName !== name) {
            namesByCanonicalName.set(canonicalName, null);
        }
    }

    return new Proxy(values as Record<string, T | undefined>, {
        get(target, property, receiver) {
            if (typeof property !== 'string' || Object.hasOwn(target, property)) {
                return Reflect.get(target, property, receiver);
            }

            const matchingName = namesByCanonicalName.get(property.toUpperCase());
            return matchingName ? target[matchingName] : undefined;
        },
    });
}
