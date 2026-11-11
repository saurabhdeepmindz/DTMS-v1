// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- The harness mounts a parent and its fragment child. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compile, computed, createApp, defineComponent, h, nextTick, reactive, ref, shallowRef } from 'vue';

import type { StyleDynamicVariable, StyleSurfaceKind } from '@/_common/helpers/styleCompiler';
import { registerStyleDynamicVariable } from '@/_front/services/styleCompilerRuntimeVariables';
import { useStyleCompilerDynamicVariables } from './useStyleCompilerDynamicVariables';

const runtime = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('@/_front/services/styleCompilerRuntimeStyleSheet', () => ({
    createStyleCompilerRuntimeVariableRegistrationKey: (id: string, variable: StyleDynamicVariable) =>
        `${id}:${variable.property}`,
    isStyleCompilerRuntimeVariableValueAccepted: () => true,
    setStyleCompilerRuntimeVariable: ({ componentId, variable, cssValue }) => {
        const key = `${componentId}:${variable.property}`;
        runtime.values.set(key, cssValue);
        return () => runtime.values.delete(key);
    },
}));
vi.mock('@/_front/services/styleFormulaExecutor', () => ({
    styleFormulaExecutor: {
        execute: (property: string, context: Record<string, string>) => ({
            status: 'resolved',
            value: context[property],
        }),
    },
}));

const cleanups: (() => void)[] = [];
afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup();
    cleanups.length = 0;
    runtime.values.clear();
    document.body.replaceChildren();
});

function registerVariables(kind: StyleSurfaceKind = 'element') {
    for (const property of ['color', 'display']) {
        cleanups.push(
            registerStyleDynamicVariable({
                name: `--ww-style-${property}`,
                surface: { key: `${kind}:text`, group: 'element', kind, selector: '.ww-text' },
                group: 'element',
                sourceUid: 'text',
                domain: 'style',
                property,
                state: 'base',
                breakpoint: 'default',
                value: property,
                cssProperty: property,
                selector: '.ww-text',
            })
        );
    }
}

function mountTarget({ comments = true, kind = 'element' as StyleSurfaceKind, withTargetId = true } = {}) {
    const visible = ref(true);
    const targetActive = ref(true);
    const values = reactive({ color: 'red', display: 'none' });
    const component = shallowRef();
    const id = `${document.body.childElementCount + 1}`;
    const targetKey =
        kind === 'section-container'
            ? 'sectionContainer'
            : kind === 'section-element' || kind === 'section-layout'
              ? 'sectionElement'
              : 'element';
    // Matches the editor's single element + trailing build-marker comment template shape.
    const Child = defineComponent({
        render: compile('<div class="ww-text">Text</div><!-- wwEditor:end -->', { comments }),
    });
    const Parent = defineComponent({
        setup() {
            useStyleCompilerDynamicVariables({
                sourceUid: 'text',
                context: values,
                targets: { [targetKey]: component },
                targetIds: withTargetId
                    ? { [targetKey]: computed(() => (visible.value && targetActive.value ? id : undefined)) }
                    : {},
            });
            return () => (visible.value ? h(Child, { ref: component, 'data-ww-component-id': id }) : null);
        },
    });
    const container = document.createElement('main');
    document.body.append(container);
    const app = createApp(Parent);
    app.mount(container);
    const unmount = () => app.unmount();
    cleanups.push(unmount);
    return { id, visible, targetActive, values, component, container, unmount };
}

describe('mounted dynamic style targets', () => {
    it.each([true, false])('updates independent instances with template comments=%s', async comments => {
        registerVariables();
        const first = mountTarget({ comments });
        const second = mountTarget({ comments });
        second.values.color = 'green';
        await nextTick();

        expect(first.component.value.$el.nodeType).toBe(comments ? Node.TEXT_NODE : Node.ELEMENT_NODE);
        expect(first.container.querySelector('div')?.getAttribute('data-ww-component-id')).toBe(first.id);
        expect(runtime.values.get(`${first.id}:color`)).toBe('red');
        expect(runtime.values.get(`${first.id}:display`)).toBe('none');
        expect(runtime.values.get(`${second.id}:color`)).toBe('green');

        first.values.color = 'blue';
        first.values.display = 'block';
        await nextTick();
        expect(runtime.values.get(`${first.id}:color`)).toBe('blue');
        expect(runtime.values.get(`${first.id}:display`)).toBe('block');
        expect(runtime.values.get(`${second.id}:color`)).toBe('green');

        first.visible.value = false;
        await nextTick();
        expect(runtime.values.has(`${first.id}:color`)).toBe(false);
        expect(runtime.values.has(`${first.id}:display`)).toBe(false);
        expect(runtime.values.get(`${second.id}:color`)).toBe('green');

        first.visible.value = true;
        await nextTick();
        expect(runtime.values.get(`${first.id}:color`)).toBe('blue');
        first.unmount();
        second.unmount();
        cleanups.splice(cleanups.indexOf(first.unmount), 1);
        cleanups.splice(cleanups.indexOf(second.unmount), 1);
        expect(runtime.values.size).toBe(0);
    });

    it.each(['section-container', 'section-element', 'section-layout'] as const)(
        'resolves %s by its supplied ID',
        async kind => {
            registerVariables(kind);
            const target = mountTarget({ kind });
            await nextTick();
            expect(runtime.values.get(`${target.id}:color`)).toBe('red');
            target.visible.value = false;
            await nextTick();
            expect(runtime.values.size).toBe(0);
        }
    );

    it('supports DOM refs when no target ID was supplied', async () => {
        registerVariables();
        const target = mountTarget({ comments: false, withTargetId: false });
        await nextTick();
        expect(runtime.values.get(`${target.id}:color`)).toBe('red');
    });

    it('clears an explicitly inactive target even while its previous DOM ref is still mounted', async () => {
        registerVariables();
        const target = mountTarget({ comments: false });
        await nextTick();
        expect(runtime.values.get(`${target.id}:color`)).toBe('red');

        target.targetActive.value = false;
        await nextTick();
        expect(target.component.value.$el.getAttribute('data-ww-component-id')).toBe(target.id);
        expect(runtime.values.size).toBe(0);
    });
});
