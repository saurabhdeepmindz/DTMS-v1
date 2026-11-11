import { afterEach, describe, expect, it, vi } from 'vitest';
import { withStoreRegistry } from './testRegistry.test-support';
import { useBackAuthStore } from './backAuth';
import { useBackTableFormulaColumnsStore } from './backTableFormulaColumns';
import { useBackTableViewsStore } from './backTableViews';
import { useBackTablesStore } from './backTables';
import { useComponentBasesStore } from './componentBases';
import { useAiResourceAccessesStore } from './editor/aiResourceAccesses';
import { useBackRolesStore } from './editor/backRoles';
import { useBackStorageStore } from './editor/backStorage';
import { useContextMenuStore } from './editor/contextMenu';
import { useDebuggerStore } from './editor/debugger';
import { useDeployStore } from './editor/deploy';
import { useDomainStore } from './editor/domain';
import { useEditionPanelStore } from './editor/editionPanel';
import { useEditorUIStateStore } from './editor/editorUIState';
import { useFinderStore } from './editor/finder';
import { useEditorPreferencesStore } from './editor/preferences';
import { useTopbarNavigatorLayoutStore } from './editor/topbarNavigatorLayout';
import { useViewBackStore } from './editor/viewBack';
import { useViewFrontStore } from './editor/viewFront';
import { useViewSettingsStore } from './editor/viewSettings';
import { useEnvVariablesStore } from './envVariables';
import { useHooksStore } from './hooks';
import { useIconsStore } from './icons';
import { useIntegrationsStore } from './integrations';
import { usePopupStore } from './popup';
import { useVariablesStore } from './variables';

const factories = {
    backAuth: useBackAuthStore,
    backTableFormulaColumns: useBackTableFormulaColumnsStore,
    backTableViews: useBackTableViewsStore,
    backTables: useBackTablesStore,
    componentBases: useComponentBasesStore,
    aiResourceAccesses: useAiResourceAccessesStore,
    backRoles: useBackRolesStore,
    backStorage: useBackStorageStore,
    contextMenu: useContextMenuStore,
    debugger: useDebuggerStore,
    deploy: useDeployStore,
    domain: useDomainStore,
    editionPanel: useEditionPanelStore,
    editorUIState: useEditorUIStateStore,
    finder: useFinderStore,
    editorPreferences: useEditorPreferencesStore,
    topbarNavigatorLayout: useTopbarNavigatorLayoutStore,
    viewBack: useViewBackStore,
    viewFront: useViewFrontStore,
    viewSettings: useViewSettingsStore,
    envVariables: useEnvVariablesStore,
    hooks: useHooksStore,
    icons: useIconsStore,
    integrations: useIntegrationsStore,
    popups: usePopupStore,
    variables: useVariablesStore,
};

afterEach(() => vi.unstubAllGlobals());

describe('additional application registry stores', () => {
    for (const [key, factory] of Object.entries(factories)) {
        it('lazily resolves the native ' + key + ' store from the installed runtime', () => {
            vi.stubGlobal('__WW_STORE_FRONT_COMPONENT_CONFIGS__', {});
            vi.stubGlobal('__WW_STORE_FRONT_TABLE_VIEWS__', {});
            vi.stubGlobal('__WW_STORE_FRONT_CONNECTIONS__', {});
            vi.stubGlobal('__WW_STORE_FRONT_INTEGRATION_TABLES__', {});
            const { $pinia: pinia, store: registry } = withStoreRegistry({ editorUXStore: { popupGroups: {} } });
            expect(Object.keys(pinia.state.value)).toEqual([]);
            const native = registry[key];
            expect(native).toBe(factory(pinia));
        });
    }
});
