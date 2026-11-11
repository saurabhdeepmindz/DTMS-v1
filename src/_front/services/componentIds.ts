export const WW_COMPONENT_ID_ATTRIBUTE = 'data-ww-component-id';

let nextComponentId = 1;

/**
 * Creates a runtime-unique id for one mounted component or styled surface.
 */
export function createComponentId() {
    return nextComponentId++;
}

/**
 * Reads the mounted component id used to target runtime CSS variable rules.
 */
export function getMountedComponentId(element: HTMLElement) {
    return element.getAttribute(WW_COMPONENT_ID_ATTRIBUTE);
}
