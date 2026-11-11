type PropertyStateSupport = (property: string) => boolean;

const supportByConfiguration = new WeakMap<object, WeakMap<object, PropertyStateSupport>>();
const noStateSupport: PropertyStateSupport = () => false;

/**
 * Builds a shared, live property-state capability lookup for one component configuration.
 *
 * The legacy resolver checked each content property's `states` flag before reading state-specific
 * source, class, and subclass data. Adapters pass resolved inherited declarations separately when
 * their source configuration is not already expanded, keeping component configuration authoritative.
 */
export function getContentPropertyStateSupport(
    configuration: unknown,
    inheritedConfiguration: unknown = configuration
): PropertyStateSupport {
    if (!isRecord(configuration)) return noStateSupport;

    const inherited = isRecord(inheritedConfiguration) ? inheritedConfiguration : configuration;
    let supportByInheritedConfiguration = supportByConfiguration.get(configuration);
    if (!supportByInheritedConfiguration) {
        supportByInheritedConfiguration = new WeakMap();
        supportByConfiguration.set(configuration, supportByInheritedConfiguration);
    }

    const cached = supportByInheritedConfiguration.get(inherited);
    if (cached) return cached;

    const supportsState: PropertyStateSupport = property => {
        const inheritedPropertyConfiguration = getPropertyConfiguration(inherited, property);
        if (inheritedPropertyConfiguration) return inheritedPropertyConfiguration.states === true;

        return getPropertyConfiguration(configuration, property)?.states === true;
    };
    supportByInheritedConfiguration.set(inherited, supportsState);
    return supportsState;
}

function getPropertyConfiguration(configuration: Record<string, unknown>, property: string) {
    if (!isRecord(configuration.properties)) return undefined;

    const propertyConfiguration = configuration.properties[property];
    return isRecord(propertyConfiguration) ? propertyConfiguration : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
