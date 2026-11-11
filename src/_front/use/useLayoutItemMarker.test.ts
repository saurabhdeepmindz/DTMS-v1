import { createSSRApp, defineComponent, h, ref, toRef, unref } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { describe, expect, it } from 'vitest';

import { LAYOUT_ITEM_ATTRIBUTE } from '@/_common/helpers/styleCompiler/layoutContract';
import {
    consumeLayoutItemStyle,
    provideLayoutItemIndex,
    provideLayoutItemStyle,
    resetLayoutItemIndex,
    useLayoutItemAttribute,
    useLayoutItemStyle,
} from './useLayoutItemMarker';

describe('useLayoutItemMarker', () => {
    it('marks actual layout items without marking layout headers', async () => {
        const Element = defineComponent({
            setup() {
                const attribute = useLayoutItemAttribute();
                return () => h('div', { [LAYOUT_ITEM_ATTRIBUTE]: attribute.value });
            },
        });
        const Layout = defineComponent({
            setup(_, { slots }) {
                resetLayoutItemIndex();
                return () => h('section', [slots.header?.(), slots.default?.()]);
            },
        });
        const Item = defineComponent({
            props: {
                index: { type: Number, required: true },
            },
            setup(props, { slots }) {
                provideLayoutItemIndex(toRef(props, 'index'));
                return () => slots.default?.();
            },
        });
        const app = createSSRApp({
            render() {
                return h(
                    Layout,
                    {},
                    {
                        header: () => h(Element),
                        default: () => h(Item, { index: 0 }, () => h(Element)),
                    }
                );
            },
        });

        const html = await renderToString(app);

        expect(html.split(LAYOUT_ITEM_ATTRIBUTE)).toHaveLength(2);
    });

    it('consumes a reactive item style without leaking it to descendants', async () => {
        const style = ref({ marginTop: 'auto' });
        const Descendant = defineComponent({
            setup() {
                const inheritedStyle = useLayoutItemStyle();
                return () => h('span', { style: unref(inheritedStyle) });
            },
        });
        const ItemRoot = defineComponent({
            setup() {
                const itemStyle = consumeLayoutItemStyle();
                return () => h('div', { style: unref(itemStyle) }, [h(Descendant)]);
            },
        });
        const Item = defineComponent({
            setup() {
                provideLayoutItemStyle(style);
                return () => h(ItemRoot);
            },
        });
        const app = createSSRApp({ render: () => h(Item) });

        const html = await renderToString(app);

        expect(html).toContain('<div style="margin-top:auto;">');
        expect(html.match(/margin-top:auto/g)).toHaveLength(1);
    });
});
