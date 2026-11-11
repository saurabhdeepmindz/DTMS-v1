import { describe, it, expect } from 'vitest';
import { getActionUsageId, getPanelUsageId, getPropertyUsageId } from './usageTrackingIds';

describe('getPropertyUsageId', () => {
    it('reads a style property from its path', () => {
        expect(getPropertyUsageId('_state.style.margin')).toBe('editStyle:margin');
        expect(getPropertyUsageId('_state.style.borderRadius')).toBe('editStyle:borderRadius');
    });

    it('keeps the group of an inherited style property', () => {
        expect(getPropertyUsageId('content._ww-text_fontSize')).toBe('editStyle:text.fontSize');
        expect(getPropertyUsageId('content._ww-layout_rowGap')).toBe('editStyle:layout.rowGap');
        expect(getPropertyUsageId('content._ww-grid_columns')).toBe('editStyle:grid.columns');
    });

    it('names the background video properties', () => {
        expect(getPropertyUsageId('content._ww-backgroundVideo')).toBe('editStyle:backgroundVideo.video');
        expect(getPropertyUsageId('content._ww-backgroundVideoPoster')).toBe('editStyle:backgroundVideo.poster');
    });

    it('counts a style edit on an open keyframe as a keyframe edit', () => {
        expect(getPropertyUsageId('_state.style.opacity', { isKeyframe: true })).toBe('editKeyframe');
    });

    it('reads settings from the element state', () => {
        expect(getPropertyUsageId('_state.link')).toBe('editSettings:link');
        expect(getPropertyUsageId('_state.id')).toBe('editSettings:htmlId');
        expect(getPropertyUsageId('_state.class')).toBe('editSettings:htmlClass');
        expect(getPropertyUsageId('_state.attributes')).toBe('editSettings:attributes');
        expect(getPropertyUsageId('_state.dropzoneContext.data')).toBe('editSettings:dropzoneContext');
        expect(getPropertyUsageId('_state.style.conditionalRendering')).toBe('editSettings:conditionalRendering');
    });

    // The paths of EditionSectionState
    it('reads the field of a state', () => {
        expect(getPropertyUsageId('_state.states[2].label')).toBe('editState:label');
        expect(getPropertyUsageId('_state.states[0].condition')).toBe('editState:condition');
        expect(getPropertyUsageId('_state.states[12].isAppliedToChildren')).toBe('editState:isAppliedToChildren');
    });

    it('leaves the element workflows to their own tracking', () => {
        expect(getPropertyUsageId('_state.interactions')).toBeNull();
    });

    it('counts a rename', () => {
        expect(getPropertyUsageId('name')).toBe('renameElement');
        expect(getPropertyUsageId('sectionTitle')).toBe('renameElement');
    });

    it('keys an element prop by the element name', () => {
        expect(getPropertyUsageId('content.text.en', { componentType: 'element', elementName: 'ww-button' })).toBe(
            'editElementProp:ww-button.text'
        );
    });

    // The paths of EditionFieldArray, EditionFieldArrayCompact and EditionFieldObjectListItem
    it('keys an array item by its array, without the index', () => {
        const target = { componentType: 'element', elementName: 'ww-select' };
        expect(getPropertyUsageId('content.options[3]', target)).toBe('editElementProp:ww-select.options');
        expect(getPropertyUsageId('content.options[3].label', target)).toBe('editElementProp:ww-select.options');
    });

    it('groups the props of a library component', () => {
        expect(getPropertyUsageId('content.a1b2c3', { componentType: 'libraryComponent', elementName: 'lib-1' })).toBe(
            'editElementProp:libraryComponent'
        );
    });

    it('ignores an unknown path', () => {
        expect(getPropertyUsageId('other.path')).toBeNull();
    });
});

describe('getPanelUsageId', () => {
    it('names the Front panels', () => {
        expect(getPanelUsageId('editor-view-front', 'pages')).toBe('openPanel:pages');
        expect(getPanelUsageId('editor-view-front', 'plugin-auth')).toBe('openPanel:pluginAuth');
        expect(getPanelUsageId('editor-view-front', 'plugin-supabase')).toBe('openPanel:supabase');
    });

    it('prefixes the Back panels', () => {
        expect(getPanelUsageId('editor-view-back', 'tables')).toBe('openPanel:backTables');
        expect(getPanelUsageId('editor-view-back', 'workflows')).toBe('openPanel:backWorkflows');
    });

    it('names the Settings tabs', () => {
        expect(getPanelUsageId('editor-view-settings', 'agent-permissions')).toBe('openSettings:agentPermissions');
        expect(getPanelUsageId('editor-view-settings', 'env-variables')).toBe('openSettings:envVariables');
    });

    it('ignores a panel bar without a known id', () => {
        expect(getPanelUsageId(undefined, 'pages')).toBeNull();
        expect(getPanelUsageId('other-panel', 'pages')).toBeNull();
    });
});

describe('getActionUsageId', () => {
    const namespaces: Record<string, string> = { '0f2b4c1e-1111-4222-8333-944455556666': 'rest-api' };
    const getNamespace = (pluginId: string) => namespaces[pluginId];

    it('keeps a plain action type', () => {
        expect(getActionUsageId('if', getNamespace)).toBe('addAction:if');
        expect(getActionUsageId('change-page', getNamespace)).toBe('addAction:change-page');
    });

    it('keeps the integration of an integration action', () => {
        expect(getActionUsageId('weweb-auth/signin-email', getNamespace)).toBe('addAction:weweb-auth/signin-email');
    });

    it('drops the target of an action', () => {
        expect(getActionUsageId('execute-workflow:4c2a', getNamespace)).toBe('addAction:execute-workflow');
        expect(getActionUsageId('execute-backend-workflow:9f1d', getNamespace)).toBe(
            'addAction:execute-backend-workflow'
        );
    });

    it('groups element methods', () => {
        expect(getActionUsageId('_wwLocalMethod_abc.open', getNamespace)).toBe('addAction:elementMethod');
    });

    it('names a legacy plugin action by its namespace', () => {
        expect(getActionUsageId('0f2b4c1e-1111-4222-8333-944455556666-request', getNamespace)).toBe(
            'addAction:rest-api/request'
        );
        expect(getActionUsageId('aaaaaaaa-1111-4222-8333-944455556666-request', getNamespace)).toBe(
            'addAction:plugin/request'
        );
    });
});
