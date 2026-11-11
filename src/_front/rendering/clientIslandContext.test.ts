import { createCommentVNode, createSSRApp, defineComponent, getCurrentInstance, h, unref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClientIslandRendering } from './useClientIslandRendering';
import {
    ClientIslandRenderError,
    captureClientIslandError,
    completeClientIslandServerRender,
    createClientIslandBaseId,
    createClientIslandId,
    isKnownClientIsland,
    prepareClientIslandServerRender,
    releaseClientIslandHydrationState,
    shouldRenderClientIsland,
} from './clientIslandContext';
import { activateStaticRendering, deactivateStaticRendering, StaticRenderFatalError } from './staticRenderingContext';
import type { RenderMode } from './renderMode';

const islandId = createClientIslandId('element', 'hero-title');
const baseIslandId = createClientIslandBaseId('element', 'IslandContent');

describe('Client Island rendering', () => {
    afterEach(() => {
        completeClientIslandServerRender();
        releaseClientIslandHydrationState();
        deactivateStaticRendering();
    });

    it('renders an explicit static-rendering opt-out as a client island', async () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        const html = await renderBoundary({
            forceClientOnly: true,
            renderChild: () => h('strong', 'browser only'),
        });
        const result = completeClientIslandServerRender();

        expect(html).toBe('<!---->');
        expect(result.clientIslandIds).toEqual([baseIslandId]);
        expect(result.discoveredClientIslandIds).toEqual([]);
        expect(result.diagnostics).toEqual([]);
    });

    it('contains a descendant SSR failure and discovers a local client island', async () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        const html = await renderBoundary({
            renderChild: () =>
                h(
                    defineComponent({
                        name: 'BrokenElement',
                        setup() {
                            return () => {
                                throw new Error('window-only renderer');
                            };
                        },
                    })
                ),
        });
        const result = completeClientIslandServerRender();

        expect(html).toBe('<!---->');
        expect(result.clientIslandIds).toEqual([islandId]);
        expect(result.discoveredClientIslandIds).toEqual([islandId]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                category: 'component-render-error',
                componentName: 'BrokenElement',
                message: 'window-only renderer',
            }),
        ]);
    });

    it('reports an intentional rich-text fallback without hiding it as a generic render error', async () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        const html = await renderBoundary({
            renderChild: () =>
                h(
                    defineComponent({
                        name: 'UnsafeRichText',
                        setup() {
                            return () => {
                                throw new ClientIslandRenderError(
                                    'invalid-rich-text-markup',
                                    'Rich text root <p> is rewritten by the HTML parser.'
                                );
                            };
                        },
                    })
                ),
        });
        const result = completeClientIslandServerRender();

        expect(html).toBe('<!---->');
        expect(result.clientIslandIds).toEqual([islandId]);
        expect(result.diagnostics).toEqual([
            expect.objectContaining({
                category: 'invalid-rich-text-markup',
                componentName: 'UnsafeRichText',
                message: 'Rich text root <p> is rewritten by the HTML parser.',
            }),
        ]);
    });

    it('deduplicates equivalent render diagnostics while retaining every island id', () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        for (let index = 0; index < 25; index++) {
            captureClientIslandError(
                createClientIslandId('element', `broken-${index}`),
                new Error('shared renderer failure'),
                { phase: 'render function' }
            );
        }

        const result = completeClientIslandServerRender();

        expect(result.clientIslandIds).toHaveLength(25);
        expect(result.discoveredClientIslandIds).toHaveLength(25);
        expect(result.diagnostics).toHaveLength(1);
    });

    it('bounds distinct render diagnostics without dropping island ids', () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        for (let index = 0; index < 25; index++) {
            captureClientIslandError(
                createClientIslandId('element', `broken-${index}`),
                new Error(`renderer failure ${index}`),
                { phase: 'render function' }
            );
        }

        const result = completeClientIslandServerRender();

        expect(result.clientIslandIds).toHaveLength(25);
        expect(result.diagnostics).toHaveLength(20);
    });

    it('preserves an explicit module-load diagnostic category', () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        captureClientIslandError(islandId, new Error('module evaluation failed'), {
            category: 'component-module-load-error',
            componentName: 'wwobject-broken',
            phase: 'component-module-load',
        });

        expect(completeClientIslandServerRender().diagnostics).toEqual([
            expect.objectContaining({
                category: 'component-module-load-error',
                componentName: 'wwobject-broken',
                source: 'component-module-load',
            }),
        ]);
    });

    it('replaces the compiled server renderer after a captured setup failure', async () => {
        const ssrRender = vi.fn((_context, push: (html: string) => void) => push('<strong>invalid</strong>'));
        activateStaticRendering();
        prepareClientIslandServerRender();

        const html = await renderBoundary({
            renderChild: () =>
                h(
                    defineComponent({
                        name: 'BrokenCompiledElement',
                        setup() {
                            throw new Error('compiled setup failure');
                        },
                        ssrRender,
                    })
                ),
        });
        const result = completeClientIslandServerRender();

        expect(html).toBe('<!---->');
        expect(ssrRender).not.toHaveBeenCalled();
        expect(result.discoveredClientIslandIds).toEqual([islandId]);
    });

    it('does not turn an error from another owner child into a client island', async () => {
        const IslandContent = defineComponent({
            name: 'IslandContent',
            setup: () => () => h('strong', 'island content'),
        });
        const BrokenSibling = defineComponent({
            name: 'BrokenSibling',
            setup: () => () => {
                throw new Error('unrelated owner child');
            },
        });
        const Owner = defineComponent({
            components: { IslandContent },
            setup() {
                useClientIslandRendering({
                    type: 'element',
                    uid: 'hero-title',
                    componentName: 'IslandContent',
                    forceClientOnly: () => false,
                    mode: 'ssr',
                });
                return () => h('div', [h(BrokenSibling), h(IslandContent)]);
            },
        });
        activateStaticRendering();
        prepareClientIslandServerRender();

        await expect(renderToString(createSSRApp(Owner))).rejects.toThrow('unrelated owner child');
        expect(completeClientIslandServerRender().clientIslandIds).toEqual([]);
    });

    it('skips a discovered island before the canonical server render', async () => {
        const renderChild = vi.fn(() => h('strong', 'must not render'));
        activateStaticRendering();
        prepareClientIslandServerRender([islandId]);

        const html = await renderBoundary({ renderChild });
        const result = completeClientIslandServerRender();

        expect(html).toBe('<!---->');
        expect(renderChild).not.toHaveBeenCalled();
        expect(result.clientIslandIds).toEqual([islandId]);
        expect(result.discoveredClientIslandIds).toEqual([]);
    });

    it('uses one base island id for every instance of an unavailable component base', () => {
        activateStaticRendering();
        prepareClientIslandServerRender([baseIslandId]);

        expect(isKnownClientIsland(baseIslandId)).toBe(true);
        expect(shouldRenderClientIsland(islandId, false, baseIslandId)).toBe(true);
        expect(
            shouldRenderClientIsland(createClientIslandId('element', 'repeated-instance'), false, baseIslandId)
        ).toBe(true);

        expect(completeClientIslandServerRender().clientIslandIds).toEqual([baseIslandId]);
    });

    it('mounts a known island only after static rendering is deactivated', async () => {
        const renderChild = vi.fn(() => h('strong', 'runtime'));
        activateStaticRendering();
        prepareClientIslandServerRender([islandId]);

        expect(await renderBoundary({ renderChild })).toBe('<!---->');
        expect(renderChild).not.toHaveBeenCalled();

        completeClientIslandServerRender();
        deactivateStaticRendering();

        expect(await renderBoundary({ renderChild })).toBe('<strong>runtime</strong>');
        expect(renderChild).toHaveBeenCalledOnce();
    });

    it('releases known client-island ids after hydration completes', () => {
        activateStaticRendering();
        prepareClientIslandServerRender([islandId]);
        completeClientIslandServerRender();

        expect(shouldRenderClientIsland(islandId, false)).toBe(true);

        releaseClientIslandHydrationState();

        expect(shouldRenderClientIsland(islandId, false)).toBe(false);
    });

    it('keeps the coded component as the direct runtime child', async () => {
        let ownerInstance = null;
        let childParent = null;
        const Child = defineComponent({
            props: {
                label: {
                    type: String,
                    required: true,
                },
            },
            setup(props) {
                childParent = getCurrentInstance()?.parent || null;
                return () => h('button', props.label);
            },
        });
        const Owner = defineComponent({
            components: { Child },
            setup() {
                ownerInstance = getCurrentInstance();
                const shouldRender = useClientIslandRendering({
                    type: 'element',
                    uid: 'hero-title',
                    componentName: 'Child',
                    forceClientOnly: () => false,
                    mode: 'runtime',
                });
                expect(shouldRender).toBe(true);

                return () => (unref(shouldRender) ? h(Child, { label: 'runtime' }) : createCommentVNode());
            },
        });
        const html = await renderToString(
            createSSRApp({
                render: () => h(Owner),
            })
        );

        expect(html).toBe('<button>runtime</button>');
        expect(childParent).toBe(ownerInstance);
    });

    it('keeps an ordinary hydrated owner on the non-reactive runtime path', async () => {
        activateStaticRendering();
        prepareClientIslandServerRender();
        completeClientIslandServerRender();

        const Child = defineComponent({
            setup: () => () => h('button', 'hydrated'),
        });
        const Owner = defineComponent({
            components: { Child },
            setup() {
                const shouldRender = useClientIslandRendering({
                    type: 'element',
                    uid: 'hero-title',
                    componentName: 'Child',
                    forceClientOnly: () => false,
                    mode: 'hydrate',
                });
                expect(shouldRender).toBe(true);

                return () => (unref(shouldRender) ? h(Child) : createCommentVNode());
            },
        });

        expect(await renderToString(createSSRApp(Owner))).toBe('<button>hydrated</button>');
    });

    it('falls back to the instance island id when the component base is unavailable', () => {
        activateStaticRendering();
        prepareClientIslandServerRender([islandId]);

        const shouldRender = useClientIslandRendering({
            type: 'element',
            uid: 'hero-title',
            componentName: null,
            forceClientOnly: () => false,
            mode: 'hydrate',
        });

        expect(unref(shouldRender)).toBe(false);
    });

    it('keeps an SSR owner renderable when the component base is unavailable', async () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        const Owner = defineComponent({
            setup() {
                useClientIslandRendering({
                    type: 'element',
                    uid: 'missing-base',
                    componentName: null,
                    forceClientOnly: () => false,
                    mode: 'ssr',
                });
                return () => createCommentVNode();
            },
        });

        await expect(renderToString(createSSRApp(Owner))).resolves.toBe('<!---->');
    });

    it('retains reactive release state only for an actual hydration island', async () => {
        let shouldRender: ReturnType<typeof useClientIslandRendering> = true;
        activateStaticRendering();
        prepareClientIslandServerRender([islandId]);
        completeClientIslandServerRender();

        const Child = defineComponent({
            setup: () => () => h('button', 'runtime'),
        });
        const Owner = defineComponent({
            components: { Child },
            setup() {
                shouldRender = useClientIslandRendering({
                    type: 'element',
                    uid: 'hero-title',
                    componentName: 'Child',
                    forceClientOnly: () => false,
                    mode: 'hydrate',
                });

                return () => (unref(shouldRender) ? h(Child) : createCommentVNode());
            },
        });

        expect(await renderToString(createSSRApp(Owner))).toBe('<!---->');
        expect(shouldRender).not.toBe(true);
        expect(unref(shouldRender)).toBe(false);

        deactivateStaticRendering();

        expect(unref(shouldRender)).toBe(true);
    });

    it('does not contain a fatal static renderer error as a client island', async () => {
        activateStaticRendering();
        prepareClientIslandServerRender();

        await expect(
            renderBoundary({
                renderChild: () =>
                    h(
                        defineComponent({
                            name: 'DeniedElement',
                            setup: () => () => {
                                throw new StaticRenderFatalError('Static renderer permission denied.');
                            },
                        })
                    ),
            })
        ).rejects.toThrow('Static renderer permission denied.');
        expect(completeClientIslandServerRender().clientIslandIds).toEqual([]);
    });
});

function renderBoundary({
    forceClientOnly = false,
    renderChild,
}: {
    forceClientOnly?: boolean;
    renderChild: () => ReturnType<typeof h>;
}): Promise<string> {
    const IslandContent = defineComponent({
        name: 'IslandContent',
        setup: () => renderChild,
    });
    const Owner = createClientIslandOwner('ssr', IslandContent, forceClientOnly);

    return renderToString(
        createSSRApp({
            render: () => h(Owner),
        })
    );
}

function createClientIslandOwner(
    mode: RenderMode,
    IslandContent: ReturnType<typeof defineComponent>,
    forceClientOnly: boolean
) {
    return defineComponent({
        components: { IslandContent },
        setup() {
            const shouldRender = useClientIslandRendering({
                type: 'element',
                uid: 'hero-title',
                componentName: 'IslandContent',
                forceClientOnly: () => forceClientOnly,
                mode,
            });

            return () => (unref(shouldRender) ? h(IslandContent) : createCommentVNode());
        },
    });
}
