// Usage ids computed at the editor's chokepoints, so a field, panel or workflow action added later is
// tracked without touching the tracking code. Ids are `action:object` and never carry a value.

const INHERITED_STYLE_PREFIXES: Record<string, string> = {
    '_ww-text_': 'text',
    '_ww-layout_': 'layout',
    '_ww-grid_': 'grid',
};
const BACKGROUND_VIDEO_PREFIX = '_ww-backgroundVideo';

const STATE_SETTINGS: Record<string, string> = {
    id: 'htmlId',
    class: 'htmlClass',
};

// Ids of integrations, providers… are kebab-case: `aws-s3` → `awsS3`
export function camelCase(id: string) {
    return id.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());
}

function lowerFirst(value: string) {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

type PropertyTarget = {
    // 'element', 'section' or 'libraryComponent'
    componentType?: string;
    // The name of the element base (ww-text), or its uid when the name is not known
    elementName?: string | null;
    // The keyframe editor is open: style edits go to the selected keyframe
    isKeyframe?: boolean;
};

// The id of a property edited in the sidebar, from its path. null: not tracked from here
export function getPropertyUsageId(path: string, { componentType, elementName, isKeyframe }: PropertyTarget = {}) {
    // The sidebar indexes arrays with brackets (`_state.states[2].label`, `content.items[3]`): read as dotted segments
    const [root, key, ...rest] = path.replace(/\[(\d+)\]/g, '.$1').split('.');

    if (root === 'name' || root === 'sectionTitle') return 'renameElement';

    if (root === '_state') {
        if (!key) return null;
        if (key === 'style') {
            const prop = rest[0];
            if (!prop) return null;
            if (prop === 'conditionalRendering') return 'editSettings:conditionalRendering';
            return isKeyframe ? 'editKeyframe' : `editStyle:${prop}`;
        }
        // Workflows of the element: tracked by their own actions
        if (key === 'interactions') return null;
        if (key === 'states') return rest[1] ? `editState:${rest[1]}` : null;
        return `editSettings:${STATE_SETTINGS[key] || key}`;
    }

    if (root === 'content' && key) {
        for (const [prefix, group] of Object.entries(INHERITED_STYLE_PREFIXES)) {
            if (key.startsWith(prefix)) return `editStyle:${group}.${key.slice(prefix.length)}`;
        }
        if (key.startsWith(BACKGROUND_VIDEO_PREFIX)) {
            return `editStyle:backgroundVideo.${lowerFirst(key.slice(BACKGROUND_VIDEO_PREFIX.length)) || 'video'}`;
        }
        // Props of a library component have generated ids: they are only counted as a whole
        if (componentType === 'libraryComponent') return 'editElementProp:libraryComponent';
        return `editElementProp:${elementName || componentType || 'unknown'}.${key}`;
    }

    return null;
}

const PANEL_PREFIXES: Record<string, (tabId: string) => string> = {
    'editor-view-front': tabId => `openPanel:${camelCase(tabId.replace(/^plugin-supabase$/, 'supabase'))}`,
    'editor-view-back': tabId => `openPanel:back${camelCase(`-${tabId}`)}`,
    'editor-view-settings': tabId => `openSettings:${camelCase(tabId)}`,
};

// The id of a left panel opened from the icon bar of the Front, Back or Settings view
export function getPanelUsageId(viewId: string | undefined, tabId: string) {
    const toId = viewId && PANEL_PREFIXES[viewId];
    return toId ? toId(tabId) : null;
}

const LEGACY_PLUGIN_ACTION = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.+)$/;
const ELEMENT_METHOD_PREFIX = '_wwLocalMethod_';

// The id of a workflow action added in the workflow editor, front or back.
// The workflow or element an action points to is dropped: `execute-workflow:<id>` is `addAction:execute-workflow`
export function getActionUsageId(type: string, getPluginNamespace: (pluginId: string) => string | undefined) {
    if (type.startsWith(ELEMENT_METHOD_PREFIX)) return 'addAction:elementMethod';
    const legacyPlugin = type.match(LEGACY_PLUGIN_ACTION);
    if (legacyPlugin) {
        const [, pluginId, code] = legacyPlugin;
        return `addAction:${getPluginNamespace(pluginId) || 'plugin'}/${code}`;
    }
    return `addAction:${type.split(':')[0]}`;
}
