import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    STYLE_COMPONENT_LAYER,
    STYLE_CORE_LAYER,
    STYLE_LAYER_ORDER,
    STYLE_LAYOUT_OVERRIDE_LAYER,
    STYLE_RESET_LAYER,
    STYLE_RULE_GROUP_LAYERS,
    STYLE_RUNTIME_LAYER,
} from './types';

describe('style compiler layers', () => {
    it('keeps shared defaults below components and runtime implementation CSS above them', () => {
        expect(STYLE_LAYER_ORDER.indexOf(STYLE_RESET_LAYER)).toBeLessThan(
            STYLE_LAYER_ORDER.indexOf(STYLE_COMPONENT_LAYER)
        );
        expect(STYLE_LAYER_ORDER.indexOf(STYLE_COMPONENT_LAYER)).toBeLessThan(
            STYLE_LAYER_ORDER.indexOf(STYLE_CORE_LAYER)
        );
        expect(STYLE_LAYER_ORDER.indexOf(STYLE_RULE_GROUP_LAYERS.element)).toBeLessThan(
            STYLE_LAYER_ORDER.indexOf(STYLE_LAYOUT_OVERRIDE_LAYER)
        );
        expect(STYLE_LAYER_ORDER.indexOf(STYLE_LAYOUT_OVERRIDE_LAYER)).toBeLessThan(
            STYLE_LAYER_ORDER.indexOf(STYLE_RUNTIME_LAYER)
        );
    });

    it('keeps the front stylesheet declaration aligned with the compiler order', () => {
        const commonCssPath = fileURLToPath(new URL('../../../assets/css/common.css', import.meta.url));
        const commonCss = readFileSync(commonCssPath, 'utf8');

        expect(commonCss.split('\n', 1)[0]).toBe(`@layer ${STYLE_LAYER_ORDER.join(', ')};`);
    });

    it('keeps the legacy neutral background below components with an element opt-out', () => {
        const commonCssPath = fileURLToPath(new URL('../../../assets/css/common.css', import.meta.url));
        const commonCss = readFileSync(commonCssPath, 'utf8');

        expect(commonCss).toMatch(
            /@layer ww-style-reset\s*\{[\s\S]*?\.ww-element:not\(\.ww-element--ignore-background\),\s*\.ww-section\s*\{[\s\S]*?background:\s*none;/
        );
    });

    it('keeps wwLayout shared primitive defaults in the reset layer', () => {
        const wwLayoutPath = fileURLToPath(new URL('../../../_front/components/wwLayout.vue', import.meta.url));
        const wwLayout = readFileSync(wwLayoutPath, 'utf8');

        expect(wwLayout).toMatch(
            /@layer ww-style-reset\s*\{[\s\S]*?\.ww-layout\s*\{[\s\S]*?pointer-events:\s*initial;/
        );
    });

    it('keeps logical-item push-last out of generated and shared CSS', () => {
        const commonCssPath = fileURLToPath(new URL('../../../assets/css/common.css', import.meta.url));
        const commonCss = readFileSync(commonCssPath, 'utf8');

        expect(commonCss).not.toContain('data-ww-layout-push-last');
        expect(commonCss).not.toContain(':has(');
    });
});
