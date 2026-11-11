import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import wwWebsiteData from './wwWebsiteData';

// The project load and its stores, unused by appendStyles, read the environment as soon as they are imported.
vi.mock('@/helpers/loadEditor.js', () => ({ default: vi.fn() }));
vi.mock('@/_manager/services/newApi', () => ({ default: {} }));
vi.mock('@/pinia/editor/editorUIState.js', () => ({ useEditorUIStateStore: vi.fn() }));
vi.mock('@/pinia/editor/viewBack.js', () => ({ useViewBackStore: vi.fn() }));

describe('canvas style variables', () => {
    afterEach(() => vi.unstubAllGlobals());

    // Safari leaves a new sheet out of `document.styleSheets` while another stylesheet of the page is still
    // loading, which a font link appendFonts adds right before always is (WW-6158).
    it('writes the variables while the new sheet is missing from document.styleSheets', () => {
        const { document } = new JSDOM('<!doctype html><html><head></head><body></body></html>').window;
        Object.defineProperty(document, 'styleSheets', { get: () => [] });
        const styles = { primary: { id: 'primary', type: 'color', token: '#111111', alternativeToken: '#eeeeee' } };
        const lib: { wwStyleSheet?: CSSStyleSheet; [key: string]: unknown } = {
            getFrontDocument: () => document,
            // Vuex here, Pinia once release/2026-10-21 (WW-5504) is in: both, so the test holds on either side.
            $store: { getters: { 'libraries/getStyles': styles } },
            store: { libraries: { styles } },
        };
        vi.stubGlobal('wwLib', lib);

        wwWebsiteData.appendStyles();

        const rules = [...lib.wwStyleSheet!.cssRules] as CSSStyleRule[];
        expect(rules.map(rule => rule.selectorText)).toEqual([':root', '.ww-app-theme-dark']);
        expect(rules[0].cssText).toContain('--primary');
        expect(rules[1].cssText).toContain('--primary');
    });
});
