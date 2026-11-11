export const IGNORE_BACKGROUND_RESET_CLASS = 'ww-element--ignore-background';

type ElementStyleResetConfiguration = {
    options?: {
        ignoredStyleProperties?: unknown;
    };
};

/**
 * Returns the reset opt-out classes derived from a coded component configuration.
 *
 * The legacy inline renderer emitted `background: none` unless the component explicitly ignored
 * background styling. Keeping the exception as a class lets the shared reset preserve that contract
 * without generating a default declaration for every element instance.
 */
export function getElementStyleResetClasses(configuration?: ElementStyleResetConfiguration) {
    const ignoredStyleProperties = configuration?.options?.ignoredStyleProperties;
    if (!Array.isArray(ignoredStyleProperties) || !ignoredStyleProperties.includes('background')) return [];

    return [IGNORE_BACKGROUND_RESET_CLASS];
}
