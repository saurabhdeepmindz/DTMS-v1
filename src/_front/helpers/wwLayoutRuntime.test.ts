import { createSSRApp, h, provide, reactive } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { describe, expect, it, vi } from 'vitest';

import wwSimpleLayout from '@/_front/components/elements/wwSimpleLayout.vue';
import { createLayoutItemStyle, createLayoutRuntimeStyle } from './wwLayoutRuntime';

describe('wwLayout runtime style', () => {
    it('keeps block-only inline styles bounded and removes them when the family changes', () => {
        expect(createLayoutRuntimeStyle({ enabled: true, display: 'block', textAlign: 'center' })).toEqual({
            height: '100%',
            textAlign: 'center',
        });
        expect(createLayoutRuntimeStyle({ enabled: true, display: 'flex', textAlign: 'center' })).toEqual({});
    });

    it('does not apply block styles when the host does not inherit ww-layout', () => {
        expect(createLayoutRuntimeStyle({ enabled: false, display: 'block', textAlign: 'center' })).toEqual({});
    });

    it('matches legacy inline-block and empty text-alignment behavior', () => {
        expect(createLayoutRuntimeStyle({ enabled: true, display: 'inline-block', textAlign: '' })).toEqual({
            height: '100%',
        });
    });

    it('preserves element-root height while keeping block text alignment', () => {
        expect(
            createLayoutRuntimeStyle({
                enabled: true,
                display: 'block',
                textAlign: 'center',
                isElementRoot: true,
            })
        ).toEqual({ textAlign: 'center' });
    });

    it('preserves element-root height through the unconditional wwSimpleLayout compatibility path', async () => {
        const app = createSSRApp({
            setup() {
                provide('componentContent', reactive({}));
                provide('componentLayoutRuntime', {
                    inheritsLayout: false,
                    display: () => 'inline-block',
                    textAlign: () => 'right',
                    rawDisplay: () => 'inline-block',
                    displayValue: () => 'inline-block',
                    rawTextAlign: () => 'right',
                });
                return () => h(wwSimpleLayout, { class: 'ww-element' });
            },
        });
        const html = await renderToString(app);

        expect(html).toContain('class="ww-layout ww-element"');
        expect(html).toContain('style="display:inline-block;text-align:right;"');
        expect(html).not.toContain('height:100%');
    });

    it('preserves full legacy flex behavior in wwSimpleLayout without a compiler capability', async () => {
        const app = createSSRApp({
            setup() {
                provide(
                    'componentContent',
                    reactive({
                        '_ww-layout_flexDirection': 'row',
                        '_ww-layout_justifyContent': 'space-between',
                        '_ww-layout_reverse': true,
                    })
                );
                provide('componentLayoutRuntime', {
                    inheritsLayout: false,
                    display: () => 'flex',
                    textAlign: () => undefined,
                    rawDisplay: () => 'flex',
                    displayValue: () => 'flex',
                    rawTextAlign: () => undefined,
                });
                return () => h(wwSimpleLayout, { class: 'ww-element' });
            },
        });

        expect(await renderToString(app)).toContain(
            'style="display:flex;flex-direction:row-reverse;justify-content:space-between;"'
        );
    });

    it('keeps text alignment lazy for non-block wwSimpleLayout families', async () => {
        const resolveTextAlign = vi.fn(() => 'center');
        const app = createSSRApp({
            setup() {
                provide('componentContent', reactive({}));
                provide('componentLayoutRuntime', {
                    inheritsLayout: false,
                    display: () => 'flex',
                    textAlign: resolveTextAlign,
                });
                return () => h(wwSimpleLayout, { class: 'ww-element' });
            },
        });

        await renderToString(app);

        expect(resolveTextAlign).not.toHaveBeenCalled();
    });
});

describe('wwLayout item style', () => {
    it.each([
        [{ index: 2, length: 3, flexDirection: 'row', reverse: false }, { marginLeft: 'auto' }],
        [{ index: 0, length: 3, flexDirection: 'row', reverse: true }, { marginLeft: 'auto' }],
        [{ index: 2, length: 3, flexDirection: 'column', reverse: false }, { marginTop: 'auto' }],
        [{ index: 0, length: 3, flexDirection: 'column', reverse: true }, { marginTop: 'auto' }],
        [{ index: 2, length: 3, flexDirection: 'row-reverse', reverse: false }, { marginLeft: 'auto' }],
    ])('matches legacy push-last behavior for %j', (layout, expected) => {
        expect(createLayoutItemStyle({ ...layout, pushLast: true })).toEqual(expected);
    });

    it('does not move the push style from a hidden logical target to another item', () => {
        expect(
            createLayoutItemStyle({
                index: 1,
                length: 3,
                flexDirection: 'row',
                reverse: false,
                pushLast: true,
            })
        ).toBeUndefined();
    });

    it('removes push-last when its resolved value becomes falsy', () => {
        expect(
            createLayoutItemStyle({
                index: 2,
                length: 3,
                flexDirection: 'column',
                reverse: false,
                pushLast: 0,
            })
        ).toBeUndefined();
    });

    it('reuses the legacy push-last style objects across renders', () => {
        const horizontalLayout = {
            index: 2,
            length: 3,
            flexDirection: 'row',
            reverse: false,
            pushLast: true,
        };
        const verticalLayout = { ...horizontalLayout, flexDirection: 'column' };

        expect(createLayoutItemStyle(horizontalLayout)).toBe(createLayoutItemStyle(horizontalLayout));
        expect(createLayoutItemStyle(verticalLayout)).toBe(createLayoutItemStyle(verticalLayout));
    });
});
