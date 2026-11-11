import {
    computed,
    createCommentVNode,
    getCurrentInstance,
    onErrorCaptured,
    resolveDynamicComponent,
    type ComponentInternalInstance,
    type ComponentPublicInstance,
    type ComputedRef,
    type VNode,
} from 'vue';
import {
    captureClientIslandError,
    createClientIslandBaseId,
    createClientIslandId,
    shouldRenderClientIsland,
} from './clientIslandContext';
import { renderMode, type RenderMode } from './renderMode';
import { StaticRenderFatalError } from './staticRenderingContext';

type ClientIslandOwnerType = 'element' | 'section';

type ClientIslandRenderingOptions = {
    type: ClientIslandOwnerType;
    uid: string;
    componentName: string | null;
    forceClientOnly: () => boolean;
    mode?: RenderMode;
};

/**
 * Adds client-island behavior to the existing element/section owner.
 * Runtime and ordinary hydrated owners deliberately return a plain boolean and
 * register no Vue hooks or reactive state, keeping the traditional component
 * tree unchanged. Only actual hydration islands retain state until release.
 */
export function useClientIslandRendering({
    type,
    uid,
    componentName,
    forceClientOnly,
    mode = renderMode,
}: ClientIslandRenderingOptions): boolean | ComputedRef<boolean> {
    if (mode === 'runtime') return true;

    const islandId = createClientIslandId(type, uid);
    const componentBaseId = getComponentBaseId(type, componentName);
    const baseIslandId = componentBaseId ? createClientIslandBaseId(type, componentBaseId) : islandId;
    if (mode === 'hydrate') {
        if (!shouldRenderClientIsland(islandId, forceClientOnly(), baseIslandId)) return true;

        return computed(() => !shouldRenderClientIsland(islandId, forceClientOnly(), baseIslandId));
    }

    const owner = getCurrentInstance();
    const componentType = resolveDynamicComponent(componentName || '');

    onErrorCaptured((error, instance, phase) => {
        if (error instanceof StaticRenderFatalError) return;
        if (!isOwnedComponentError(instance, owner, componentType)) return;

        const componentName = getComponentName(instance);
        if (!captureClientIslandError(islandId, error, { componentName, phase })) return;

        replaceFailedServerRender(instance);
        return false;
    });

    return computed(() => !shouldRenderClientIsland(islandId, forceClientOnly(), baseIslandId));
}

function getComponentBaseId(type: ClientIslandOwnerType, componentName: string | null): string | null {
    if (!componentName) return null;
    const prefix = type === 'element' ? 'wwobject-' : 'section-';
    return componentName.startsWith(prefix) ? componentName.slice(prefix.length) : componentName;
}

function isOwnedComponentError(
    instance: ComponentPublicInstance | null,
    owner: ComponentInternalInstance | null,
    componentType: unknown
): boolean {
    if (!instance || !owner) return false;

    let root = instance.$;
    while (root.parent && root.parent !== owner) root = root.parent;
    return root.parent === owner && root.type === componentType;
}

function getComponentName(instance: ComponentPublicInstance | null): string | null {
    const name = (instance?.$options as { name?: unknown } | undefined)?.name;
    return typeof name === 'string' ? name : null;
}

/**
 * Vue continues into a compiled SFC's `ssrRender` after a captured setup error.
 * Override only that failed server instance so the discovery pass can finish;
 * the canonical pass skips the island before creating the child at all.
 */
function replaceFailedServerRender(instance: ComponentPublicInstance | null): void {
    const internalInstance = instance?.$ as
        | {
              render?: () => VNode;
              ssrRender?: (_context: unknown, push: (html: string) => void) => void;
          }
        | undefined;
    if (!internalInstance) return;

    internalInstance.render = () => createCommentVNode();
    internalInstance.ssrRender = (_context, push) => push('<!---->');
}
