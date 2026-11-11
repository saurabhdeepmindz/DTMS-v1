import { createSSRApp, defineComponent, h, provide, reactive } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/_front/use/useElementLocalContext', () => ({ useRegisterElementLocalContext: vi.fn() }));
vi.mock('@/_common/helpers/component/component.js', () => ({ getComponentLabel: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: vi.fn() }));

import wwElementService from './wwElement';

describe('wwElement public layout compatibility helper', () => {
    it('renders the provided legacy layout values for coded component roots', async () => {
        const Consumer = defineComponent({
            setup() {
                const style = wwElementService.useLayoutStyle();
                return () => h('div', { style: style.value });
            },
        });
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
                    inheritsLayout: true,
                    display: () => 'flex',
                    textAlign: () => undefined,
                    rawDisplay: () => 'flex',
                    displayValue: () => 'flex',
                    rawTextAlign: () => undefined,
                });
                return () => h(Consumer, { class: 'ww-element' });
            },
        });

        const html = await renderToString(app);

        expect(html).toContain('style="display:flex;flex-direction:row-reverse;justify-content:space-between;"');
    });

    it('does not force legacy fill height on the coded element root', async () => {
        const Consumer = defineComponent({
            setup() {
                const style = wwElementService.useLayoutStyle();
                return () => h('div', { style: style.value });
            },
        });
        const app = createSSRApp({
            setup() {
                provide('componentContent', reactive({}));
                provide('componentLayoutRuntime', {
                    inheritsLayout: true,
                    display: () => 'block',
                    textAlign: () => 'center',
                    rawDisplay: () => 'block',
                    displayValue: () => 'block',
                    rawTextAlign: () => 'center',
                });
                return () => h(Consumer, { class: 'ww-element' });
            },
        });

        const html = await renderToString(app);

        expect(html).toContain('style="display:block;text-align:center;"');
        expect(html).not.toContain('height:100%');
    });
});
