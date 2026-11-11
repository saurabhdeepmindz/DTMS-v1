import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { encodeStyleSourceId } from '@/_common/helpers/styleCompiler';

import {
    mergeLayoutStyleScopeUids,
    provideLibraryComponentLayoutStyleScope,
    resetLibraryComponentLayoutStyleScopes,
    useLayoutStyleScopeAttribute,
} from './useLayoutStyleScopes';

describe('useLayoutStyleScopes', () => {
    it('preserves scope order while removing empty and duplicate uids', () => {
        expect(mergeLayoutStyleScopeUids(['root', null], ['instance', 'root', undefined])).toEqual([
            'root',
            'instance',
        ]);
    });

    it('carries renderless library scopes to the root layout and resets them for child elements', async () => {
        const LibraryScope = defineComponent({
            props: {
                uid: { type: String, required: true },
                styleSourceId: { type: Number, default: undefined },
            },
            setup(props, { slots }) {
                provideLibraryComponentLayoutStyleScope(
                    () => props.uid,
                    () => props.styleSourceId
                );
                return () => slots.default?.();
            },
        });
        const Layout = defineComponent({
            props: {
                ownerUid: { type: String, required: true },
                styleSourceId: { type: Number, default: undefined },
            },
            setup(props, { slots }) {
                const scopes = useLayoutStyleScopeAttribute(
                    () => props.ownerUid,
                    () => props.styleSourceId
                );
                return () => h('div', { 'data-layout-scopes': scopes.value }, slots.default?.());
            },
        });
        const ElementBoundary = defineComponent({
            setup(_, { slots }) {
                resetLibraryComponentLayoutStyleScopes();
                return () => slots.default?.();
            },
        });
        const app = createSSRApp({
            render() {
                return h(LibraryScope, { uid: 'page-instance' }, () => {
                    return h(LibraryScope, { uid: 'nested-library-root' }, () => {
                        return h(Layout, { ownerUid: 'coded-component-root' }, () => [
                            h(Layout, { ownerUid: 'coded-component-root' }),
                            h(ElementBoundary, () =>
                                h(LibraryScope, { uid: 'child-instance' }, () => h(Layout, { ownerUid: 'child-root' }))
                            ),
                        ]);
                    });
                });
            },
        });

        const html = await renderToString(app);
        const rootScopes = ['coded-component-root', 'page-instance', 'nested-library-root']
            .map(uid => encodeStyleSourceId(uid))
            .join(' ');
        const childScopes = ['child-root', 'child-instance'].map(uid => encodeStyleSourceId(uid)).join(' ');

        expect(html).toContain(`data-layout-scopes="${rootScopes}"`);
        expect(html.match(new RegExp(`data-layout-scopes="${rootScopes}"`, 'g'))).toHaveLength(2);
        expect(html).toContain(`data-layout-scopes="${childScopes}"`);
        expect(html).not.toContain(`${encodeStyleSourceId('child-root')} ${encodeStyleSourceId('page-instance')}`);
    });

    it('uses dense persisted ids for owners and inherited library scopes', async () => {
        const Layout = defineComponent({
            setup() {
                const scopes = useLayoutStyleScopeAttribute('owner', 3_844);
                return () => h('div', { 'data-layout-scopes': scopes.value });
            },
        });
        const app = createSSRApp(
            defineComponent({
                setup() {
                    provideLibraryComponentLayoutStyleScope('instance', 62);
                    return () => h(Layout);
                },
            })
        );

        expect(await renderToString(app)).toContain('data-layout-scopes="d100 d10"');
    });
});
