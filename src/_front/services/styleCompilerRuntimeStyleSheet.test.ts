import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import type { StyleDynamicVariable } from '@/_common/helpers/styleCompiler';
import {
    cancelStyleCompilerPrerenderRuntime,
    prepareStyleCompilerPrerenderRuntime,
} from '@/_front/rendering/styleCompilerPrerenderRuntime';
import { activateStaticRendering, deactivateStaticRendering } from '@/_front/rendering/staticRenderingContext';
import { registerStyleDynamicVariable } from './styleCompilerRuntimeVariables';
import {
    setStyleCompilerRuntimeClear,
    setStyleCompilerRuntimeVariable,
    setStyleCompilerRuntimeVariableClear,
} from './styleCompilerRuntimeStyleSheet';
import { useStyleCompilerDynamicVariables } from '@/_front/use/useStyleCompilerDynamicVariables';

const executeStyleFormula = vi.hoisted(() => vi.fn());
const executePrerenderStyleFormula = vi.hoisted(() => vi.fn());
vi.mock('./styleFormulaExecutor', () => ({
    styleFormulaExecutor: { execute: executeStyleFormula },
    prerenderStyleFormulaExecutor: { execute: executePrerenderStyleFormula },
}));

afterEach(() => {
    vi.restoreAllMocks();
    executeStyleFormula.mockReset();
    executePrerenderStyleFormula.mockReset();
    cancelStyleCompilerPrerenderRuntime();
    deactivateStaticRendering();
});

describe('styleCompilerRuntimeStyleSheet', () => {
    it.each(['element', 'section-element', 'section-layout'] as const)(
        'writes %s fragment bindings using the explicit rendered component id and cleans up hidden instances',
        async kind => {
            const doc = new FakeDocument();
            Object.assign(wwLib, { getFrontDocument: () => doc, wwLog: { warn: vi.fn() } });
            const width = ref('240px');
            const componentId = ref<number | undefined>(42);
            executeStyleFormula.mockImplementation(() => ({ status: 'resolved', value: width.value }));
            const variable = createWidthVariable();
            variable.surface.kind = kind;
            const stopRegistration = registerStyleDynamicVariable(variable);
            const scope = effectScope();
            // Vue's exposed $el for a fragment is a text marker, not its styled child.
            const component = ref({ $el: { nodeType: 3 } });
            try {
                scope.run(() => {
                    useStyleCompilerDynamicVariables({
                        sourceUid: 'sized',
                        targets: { element: component, sectionElement: component },
                        targetIds: { element: componentId, sectionElement: componentId },
                    });
                });
                await nextTick();
                expect(getRuntimeDeclarationForComponent(doc, '42', '--ww-style-width')).toBe('240px');
                width.value = '180px';
                await nextTick();
                expect(getRuntimeDeclarationForComponent(doc, '42', '--ww-style-width')).toBe('180px');
                componentId.value = undefined;
                await nextTick();
                expect(getRuntimeDeclarationForComponent(doc, '42', '--ww-style-width')).toBe('');
                componentId.value = 43;
                await nextTick();
                expect(getRuntimeDeclarationForComponent(doc, '43', '--ww-style-width')).toBe('180px');
                scope.stop();
                expect(getRuntimeDeclarationForComponent(doc, '43', '--ww-style-width')).toBe('');
            } finally {
                scope.stop();
                stopRegistration();
            }
        }
    );

    it('keeps distinct default runtime CSS for reused component instances after SSR scopes are disposed', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        executePrerenderStyleFormula.mockImplementation((_formula, context) => ({
            status: 'resolved',
            value: context.component.props.visible,
        }));
        const defaultVariable = {
            ...createLibraryVariable('definition'),
            valueNormalizer: {
                type: 'display' as const,
                allowedValues: ['flex', 'block', 'grid', 'inline-flex'],
                restrictToAllowedValues: true,
            },
        };
        const tabletVariable = { ...defaultVariable, breakpoint: 'tablet' as const };
        const stopDefault = registerStyleDynamicVariable(defaultVariable);
        const stopTablet = registerStyleDynamicVariable(tabletVariable);
        const firstScope = effectScope();
        const secondScope = effectScope();
        prepareStyleCompilerPrerenderRuntime();

        firstScope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: defaultVariable.sourceUid,
                context: { component: { props: { visible: true } } },
                targets: {},
                targetIds: { element: 101 },
            });
        });
        secondScope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: defaultVariable.sourceUid,
                context: { component: { props: { visible: false } } },
                targets: {},
                targetIds: { element: 202 },
            });
        });
        firstScope.stop();
        secondScope.stop();

        expect(getRuntimeDeclarationForComponent(doc, '101', '--ww-style-display')).toBe('flex');
        expect(getRuntimeDeclarationForComponent(doc, '202', '--ww-style-display')).toBe('none');
        expect(getGroupingRules(doc).some(rule => rule.ruleText.includes('max-width: 991px'))).toBe(false);

        stopTablet();
        stopDefault();
    });

    it('keeps static CSS untouched when a prerendered runtime variable is unresolved', () => {
        const doc = new FakeDocument();
        const warn = vi.fn();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn },
        });
        executePrerenderStyleFormula.mockReturnValue({ status: 'error', error: new Error('DOM unavailable') });
        const variable = createBorderVariable();
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        prepareStyleCompilerPrerenderRuntime();

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: variable.sourceUid,
                targets: {},
                targetIds: { element: 303 },
            });
        });
        scope.stop();

        expect(getRuntimeDeclaration(doc, '--ww-style-border')).toBe('');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border')).toBe('');
        expect(collectRules(doc.styleElement.sheet).filter(rule => rule instanceof FakeStyleRule)).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(
            '[style-compiler] unable to resolve prerendered runtime CSS variable',
            expect.objectContaining({ sourceUid: variable.sourceUid, property: variable.property })
        );

        stopRegistration();
    });

    it('waits for static projection release before creating the hydrated runtime stylesheet', async () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        executeStyleFormula.mockReturnValue({ status: 'resolved', value: 'flex' });
        const variable = createLibraryVariable('definition');
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'hydrated-library-instance',
        } as unknown as HTMLElement;
        activateStaticRendering();

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: variable.sourceUid,
                targets: { element: ref(element) },
            });
        });

        const callsBeforeRelease = executeStyleFormula.mock.calls.length;
        const sheetsBeforeRelease = doc.head.appendChild.mock.calls.length;

        deactivateStaticRendering();
        await nextTick();

        const callsAfterRelease = executeStyleFormula.mock.calls.length;
        const runtimeDisplay = getRuntimeDeclarationForComponent(
            doc,
            'hydrated-library-instance',
            '--ww-style-display'
        );

        scope.stop();
        stopRegistration();

        expect(callsBeforeRelease).toBe(0);
        expect(sheetsBeforeRelease).toBe(0);
        expect(callsAfterRelease).toBe(1);
        expect(runtimeDisplay).toBe('flex');
    });

    it('writes empty resolved values as revert-layer in the original generated layer', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable = createBorderVariable();

        const stop = setStyleCompilerRuntimeClear({ componentId: 'instance-1', variable });

        const elementLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-element {}');
        const styleRule = getFirstStyleRule(elementLayer);
        expect(styleRule?.selectorText).toContain('[data-ww-component-id="instance-1"]');
        expect(styleRule?.style.getPropertyValue('border')).toBe('revert-layer');

        stop();

        expect(getFirstStyleRule(elementLayer)).toBeUndefined();
    });

    it('preserves zero-specificity layout selectors when mounting runtime variables', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable: StyleDynamicVariable = {
            ...createWidthVariable(),
            surface: {
                ...createWidthVariable().surface,
                runtimeScopeSelector: '.ww-element-sized',
            },
            selector:
                ':where(.ww-element-sized.ww-layout[data-ww-states~="active"]) > .ww-element[data-ww-layout-item]',
        };

        const stop = setStyleCompilerRuntimeVariable({
            componentId: 'instance-layout',
            variable,
            cssValue: '100px',
        });
        const styleRule = collectRules(doc.styleElement.sheet).find(
            (rule): rule is FakeStyleRule => rule instanceof FakeStyleRule
        );

        expect(styleRule?.selectorText).toBe(
            ':where([data-ww-component-id="instance-layout"].ww-layout[data-ww-states~="active"]) > .ww-element[data-ww-layout-item]'
        );

        stop();
    });

    it('replaces a runtime value with a clear rule and restores the value without stale declarations', async () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const border = ref<unknown>('2px solid red');
        executeStyleFormula.mockImplementation(() => ({ status: 'resolved', value: border.value }));
        const variable = createBorderVariable();
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-2',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'bordered',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border')).toBe('2px solid red');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border')).toBe('');

        border.value = undefined;
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border')).toBe('');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border')).toBe('revert-layer');

        border.value = '3px solid blue';
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border')).toBe('3px solid blue');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border')).toBe('');

        scope.stop();
        stopRegistration();
    });

    it('mounts a multiline legacy gradient formula without clearing the authored background', async () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const gradient = `linear-gradient(
    212deg,
    #015186 0%,
    #039559 100%
)`;
        executeStyleFormula.mockReturnValue({ status: 'resolved', value: gradient });
        const variable = createBackgroundGradientVariable();
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-gradient',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'gradient',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-background-gradient')).toBe(gradient);
        expect(getGeneratedLayerDeclaration(doc, 'element', 'background')).toBe('');

        scope.stop();
        stopRegistration();
    });

    it('switches an effective grid placement between its primary value, span fallback, and empty state', async () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const placementFormula = { __wwtype: 'f', code: 'variables.gridColumn' };
        const spanFormula = { __wwtype: 'f', code: 'variables.columnSpan' };
        const placement = ref<unknown>('2 / 8');
        const span = ref<unknown>('6');
        executeStyleFormula.mockImplementation(formula => ({
            status: 'resolved',
            value: formula === placementFormula ? placement.value : span.value,
        }));
        const variable = {
            ...createBorderVariable(),
            name: '--ww-style-grid-column',
            sourceUid: 'grid-child',
            property: 'gridColumn',
            value: placementFormula,
            valueNormalizer: { type: 'empty-if-falsy' },
            runtimeFallback: {
                type: 'when-empty',
                value: spanFormula,
                valueNormalizer: { type: 'prefix-if-truthy', prefix: 'span ' },
            },
            cssProperty: 'grid-column',
            validationProperty: 'grid-column',
            directDeclaration: true,
            selector: '.ww-element-grid-child',
        } as StyleDynamicVariable;
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-grid-child',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'grid-child',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-grid-column')).toBe('2 / 8');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'grid-column')).toBe('');

        placement.value = '';
        await nextTick();
        expect(getRuntimeDeclaration(doc, '--ww-style-grid-column')).toBe('span 6');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'grid-column')).toBe('');

        span.value = '';
        await nextTick();
        expect(getRuntimeDeclaration(doc, '--ww-style-grid-column')).toBe('');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'grid-column')).toBe('revert-layer');

        placement.value = '3 / 7';
        await nextTick();
        expect(getRuntimeDeclaration(doc, '--ww-style-grid-column')).toBe('3 / 7');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'grid-column')).toBe('');

        scope.stop();
        stopRegistration();
    });

    it('keeps the last accepted runtime value when a reactive update is invalid', async () => {
        const doc = new FakeDocument((property, value) => property !== 'width' || value !== '10p');
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const width = ref<unknown>('100px');
        executeStyleFormula.mockImplementation(() => ({ status: 'resolved', value: width.value }));
        const stopRegistration = registerStyleDynamicVariable(createWidthVariable());
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-validity',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'sized',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('100px');

        width.value = '10p';
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('100px');

        width.value = '50%';
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('50%');

        scope.stop();
        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('');
        stopRegistration();
    });

    it('applies a legacy important runtime value to the final standard property', async () => {
        const doc = new FakeDocument((property, value) => property === 'width' && value === '100px');
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        executeStyleFormula.mockReturnValue({ status: 'resolved', value: '100px !important' });
        const stopRegistration = registerStyleDynamicVariable({
            ...createWidthVariable(),
            directDeclaration: true,
        });
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-important',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'sized',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, 'width')).toBe('100px');
        expect(getRuntimeDeclarationPriority(doc, 'width')).toBe('important');
        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('');

        scope.stop();
        stopRegistration();
    });

    it('does not create a runtime declaration when the first resolved value is invalid', async () => {
        const doc = new FakeDocument((property, value) => property !== 'width' || value !== '10p');
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        executeStyleFormula.mockReturnValue({ status: 'resolved', value: '10p' });
        const stopRegistration = registerStyleDynamicVariable(createWidthVariable());
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-initial-invalid',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'sized',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('');

        scope.stop();
        stopRegistration();
    });

    it('validates shorthand fragments against their declared value grammar', async () => {
        const supports = vi.fn(
            (property: string, value: string) => property === 'background-size' && value === 'cover'
        );
        const doc = new FakeDocument(supports);
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        executeStyleFormula.mockReturnValue({ status: 'resolved', value: 'cover' });
        const variable = {
            ...createWidthVariable(),
            name: '--ww-style-background-size',
            sourceUid: 'background',
            surface: {
                key: 'element:background',
                group: 'element',
                kind: 'element',
                selector: '.ww-element-background',
            },
            property: 'backgroundSize',
            cssProperty: 'background',
            validationProperty: 'background-size',
            selector: '.ww-element-background',
        } satisfies StyleDynamicVariable;
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-background',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'background',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(supports).toHaveBeenCalledWith('background-size', 'cover');
        expect(getRuntimeDeclaration(doc, '--ww-style-background-size')).toBe('cover');

        scope.stop();
        stopRegistration();
    });

    it('keeps unannotated composite fragments fail-open', async () => {
        const supports = vi.fn(() => false);
        const doc = new FakeDocument(supports);
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        executeStyleFormula.mockReturnValue({ status: 'resolved', value: 'cover' });
        const variable = {
            ...createWidthVariable(),
            name: '--ww-style-composite-fragment',
            property: 'compositeFragment',
            cssProperty: 'background',
            validationProperty: undefined,
        } satisfies StyleDynamicVariable;
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-unannotated-fragment',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'sized',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(supports).not.toHaveBeenCalled();
        expect(getRuntimeDeclaration(doc, '--ww-style-composite-fragment')).toBe('cover');

        scope.stop();
        stopRegistration();
    });

    it('reconciles repeated updates and registration removal without retaining runtime rules', async () => {
        const doc = new FakeDocument(() => true);
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const width = ref<unknown>('0px');
        executeStyleFormula.mockImplementation(() => ({ status: 'resolved', value: width.value }));
        const stopRegistration = registerStyleDynamicVariable(createWidthVariable());
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-repeated-updates',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'sized',
                targets: { element: ref(element) },
            });
        });
        for (let index = 1; index <= 50; index++) {
            width.value = `${index}px`;
            await nextTick();
        }

        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('50px');
        expect(collectRules(doc.styleElement.sheet).filter(rule => rule instanceof FakeStyleRule)).toHaveLength(1);

        stopRegistration();
        await Promise.resolve();
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-width')).toBe('');
        expect(collectRules(doc.styleElement.sheet).filter(rule => rule instanceof FakeStyleRule)).toHaveLength(0);

        scope.stop();
    });

    it('masks only the runtime variable while its condition is inactive', async () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const displayFormula = { __wwtype: 'f', code: 'variables.display' };
        const display = ref('grid');
        const displayResolved = ref(true);
        executeStyleFormula.mockImplementation(formula => {
            if (formula === displayFormula && !displayResolved.value) return { status: 'unresolved' };

            return {
                status: 'resolved',
                value: formula === displayFormula ? display.value : '2px solid red',
            };
        });
        const variable = {
            ...createBorderVariable(),
            breakpoint: 'tablet',
            condition: { value: displayFormula, allowedValues: ['flex'] },
        } satisfies StyleDynamicVariable;
        const stopRegistration = registerStyleDynamicVariable(variable);
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-conditional',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'bordered',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border', 'tablet')).toBe('revert-layer');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border', 'tablet')).toBe('');

        display.value = 'flex';
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border', 'tablet')).toBe('2px solid red');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border', 'tablet')).toBe('');

        display.value = 'grid';
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border', 'tablet')).toBe('revert-layer');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border', 'tablet')).toBe('');

        displayResolved.value = false;
        await nextTick();

        expect(getRuntimeDeclaration(doc, '--ww-style-border', 'tablet')).toBe('');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border', 'tablet')).toBe('');

        scope.stop();
        stopRegistration();
    });

    it('clears a conditional variable without clearing its generated property', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable = { ...createBorderVariable(), breakpoint: 'tablet' } satisfies StyleDynamicVariable;

        const stop = setStyleCompilerRuntimeVariableClear({ componentId: 'instance-conditional', variable });

        expect(getRuntimeDeclaration(doc, '--ww-style-border', 'tablet')).toBe('revert-layer');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'border', 'tablet')).toBe('');

        stop();

        expect(getRuntimeDeclaration(doc, '--ww-style-border', 'tablet')).toBe('');
    });

    it('keeps library definition and instance variables in ordered runtime sublayers', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });

        setStyleCompilerRuntimeVariable({
            componentId: 'library-root',
            variable: createLibraryVariable('definition'),
            cssValue: 'flex',
        });
        setStyleCompilerRuntimeVariable({
            componentId: 'library-root',
            variable: createLibraryVariable('instance'),
            cssValue: 'none',
        });

        const runtimeLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-runtime {}');
        const libraryLayer = runtimeLayer && getGroupingRule(runtimeLayer, '@layer library {}');
        const definitionLayer = libraryLayer && getGroupingRule(libraryLayer, '@layer definition {}');
        const instanceLayer = libraryLayer && getGroupingRule(libraryLayer, '@layer instance {}');
        const libraryRuleTexts = libraryLayer?.cssRules
            .filter((rule): rule is FakeRuleContainer => rule instanceof FakeRuleContainer)
            .map(rule => rule.ruleText);

        expect(libraryRuleTexts).toEqual([
            '@layer definition, instance;',
            '@layer definition {}',
            '@layer instance {}',
        ]);
        expect(getFirstStyleRule(definitionLayer)?.style.getPropertyValue('--ww-style-display')).toBe('flex');
        expect(getFirstStyleRule(instanceLayer)?.style.getPropertyValue('--ww-style-display')).toBe('none');
    });

    it('installs instance-scoped bound keyframes and removes both outputs on cleanup', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable = createKeyframesVariable();

        const stop = setStyleCompilerRuntimeVariable({
            componentId: 'instance-1',
            variable,
            cssValue: '@keyframes authored { 0% { opacity: 0; } 100% { opacity: 1; } }',
        });

        const rules = collectRules(doc.styleElement.sheet);
        const keyframesRule = rules.find(isFakeKeyframesRule);
        const styleRule = rules.find(
            (rule): rule is FakeStyleRule =>
                rule instanceof FakeStyleRule && rule.selectorText.includes('data-ww-component-id')
        );
        const runtimeName = 'ww-keyframes-element-animated-base-default-instance-1';

        expect(keyframesRule?.cssText).toContain(`@keyframes ${runtimeName}`);
        expect(styleRule?.style.getPropertyValue('--ww-style-animation-keyframes')).toBe(runtimeName);

        stop();

        expect(collectRules(doc.styleElement.sheet).some(isFakeKeyframesRule)).toBe(false);
        expect(
            collectRules(doc.styleElement.sheet).some(
                rule => rule instanceof FakeStyleRule && rule.selectorText.includes('data-ww-component-id')
            )
        ).toBe(false);
    });

    it('replaces bound keyframes reactively and removes them when the binding becomes empty', async () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const keyframes = ref('@keyframes authored { from { opacity: 0; } to { opacity: 1; } }');
        executeStyleFormula.mockImplementation(() => ({
            status: 'resolved',
            value: keyframes.value,
        }));
        const stopRegistration = registerStyleDynamicVariable(createKeyframesVariable());
        const scope = effectScope();
        const element = {
            nodeType: 1,
            style: {},
            getAttribute: () => 'instance-2',
        } as unknown as HTMLElement;

        scope.run(() => {
            useStyleCompilerDynamicVariables({
                sourceUid: 'animated',
                targets: { element: ref(element) },
            });
        });
        await nextTick();

        expect(executeStyleFormula).toHaveBeenCalled();
        expect(getKeyframesCss(doc)).toContain('to { opacity: 1; }');

        keyframes.value = '@keyframes authored { from { opacity: 1; } to { opacity: 0.25; } }';
        await nextTick();

        expect(getKeyframesRules(doc)).toHaveLength(1);
        expect(getKeyframesCss(doc)).toContain('to { opacity: 0.25; }');
        expect(getKeyframesCss(doc)).not.toContain('to { opacity: 1; }');

        keyframes.value = '';
        await nextTick();

        expect(getKeyframesRules(doc)).toHaveLength(0);
        expect(getRuntimeDeclaration(doc, '--ww-style-animation-keyframes')).toBe('');
        expect(getGeneratedLayerDeclaration(doc, 'element', 'animation-name')).toBe('revert-layer');

        scope.stop();
        stopRegistration();
    });

    it('keeps bound keyframes isolated between rendered instances', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable = createKeyframesVariable();

        const stopFirst = setStyleCompilerRuntimeVariable({
            componentId: 'instance-a',
            variable,
            cssValue: '@keyframes authored { to { opacity: 1; } }',
        });
        const stopSecond = setStyleCompilerRuntimeVariable({
            componentId: 'instance-b',
            variable,
            cssValue: '@keyframes authored { to { opacity: 0.5; } }',
        });

        expect(getKeyframesRules(doc)).toHaveLength(2);
        expect(getKeyframesRules(doc).map(rule => rule.cssText)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('ww-keyframes-element-animated-base-default-instance-a'),
                expect.stringContaining('ww-keyframes-element-animated-base-default-instance-b'),
            ])
        );

        stopFirst();

        expect(getKeyframesRules(doc)).toHaveLength(1);
        expect(getKeyframesCss(doc)).toContain('ww-keyframes-element-animated-base-default-instance-b');

        stopSecond();
        expect(getKeyframesRules(doc)).toHaveLength(0);
    });

    it('rejects invalid bound keyframes without writing an animation name', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });

        setStyleCompilerRuntimeVariable({
            componentId: 'instance-1',
            variable: createKeyframesVariable(),
            cssValue: 'body { display: none; }',
        });

        expect(getKeyframesRules(doc)).toHaveLength(0);
        expect(
            collectRules(doc.styleElement.sheet).some(
                rule => rule instanceof FakeStyleRule && rule.selectorText.includes('data-ww-component-id')
            )
        ).toBe(false);
    });

    it('clears library instance declarations inside the original instance sublayer', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });

        setStyleCompilerRuntimeClear({
            componentId: 'library-root',
            variable: createLibraryVariable('instance'),
        });

        const libraryLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-library {}');
        const definitionLayer = libraryLayer && getGroupingRule(libraryLayer, '@layer definition {}');
        const instanceLayer = libraryLayer && getGroupingRule(libraryLayer, '@layer instance {}');

        expect(getFirstStyleRule(definitionLayer)).toBeUndefined();
        expect(getFirstStyleRule(instanceLayer)?.style.getPropertyValue('display')).toBe('revert-layer');
    });

    it('keeps responsive clears in the generated layer media query', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });

        setStyleCompilerRuntimeClear({
            componentId: 'instance-mobile',
            variable: { ...createBorderVariable(), breakpoint: 'mobile' },
        });

        const elementLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-element {}');
        const mediaRule = elementLayer && getGroupingRule(elementLayer, '@media (max-width: 767px) {}');

        expect(getFirstStyleRule(elementLayer)).toBeUndefined();
        expect(getFirstStyleRule(mediaRule)?.style.getPropertyValue('border')).toBe('revert-layer');
    });

    it('keeps runtime breakpoint rules in cascade order across registration and cleanup order', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable = createBorderVariable();
        const stopMobile = setStyleCompilerRuntimeVariable({
            componentId: 'instance-responsive',
            variable: { ...variable, breakpoint: 'mobile' },
            cssValue: '3px solid green',
        });
        const stopDefault = setStyleCompilerRuntimeVariable({
            componentId: 'instance-responsive',
            variable,
            cssValue: '1px solid red',
        });
        setStyleCompilerRuntimeVariable({
            componentId: 'instance-responsive',
            variable: { ...variable, breakpoint: 'tablet' },
            cssValue: '2px solid blue',
        });

        const runtimeLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-runtime {}');
        const elementLayer = runtimeLayer && getGroupingRule(runtimeLayer, '@layer element {}');
        expect(getRuleOrder(elementLayer)).toEqual([
            'style',
            '@media (max-width: 991px) {}',
            '@media (max-width: 767px) {}',
        ]);

        stopDefault();
        stopMobile();
        setStyleCompilerRuntimeVariable({
            componentId: 'instance-responsive',
            variable,
            cssValue: '4px solid black',
        });
        setStyleCompilerRuntimeVariable({
            componentId: 'instance-responsive',
            variable: { ...variable, breakpoint: 'mobile' },
            cssValue: '5px solid white',
        });

        expect(getRuleOrder(elementLayer)).toEqual([
            'style',
            '@media (max-width: 991px) {}',
            '@media (max-width: 767px) {}',
        ]);
    });

    it('keeps runtime clear breakpoint rules in cascade order', () => {
        const doc = new FakeDocument();
        Object.assign(wwLib, {
            getFrontDocument: () => doc,
            wwLog: { warn: vi.fn() },
        });
        const variable = createBorderVariable();
        const stopMobile = setStyleCompilerRuntimeClear({
            componentId: 'instance-responsive-clear',
            variable: { ...variable, breakpoint: 'mobile' },
        });
        const stopDefault = setStyleCompilerRuntimeClear({
            componentId: 'instance-responsive-clear',
            variable,
        });
        setStyleCompilerRuntimeClear({
            componentId: 'instance-responsive-clear',
            variable: { ...variable, breakpoint: 'tablet' },
        });

        const elementLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-element {}');
        expect(getRuleOrder(elementLayer)).toEqual([
            'style',
            '@media (max-width: 991px) {}',
            '@media (max-width: 767px) {}',
        ]);

        stopDefault();
        stopMobile();
        setStyleCompilerRuntimeClear({
            componentId: 'instance-responsive-clear',
            variable,
        });
        setStyleCompilerRuntimeClear({
            componentId: 'instance-responsive-clear',
            variable: { ...variable, breakpoint: 'mobile' },
        });

        expect(getRuleOrder(elementLayer)).toEqual([
            'style',
            '@media (max-width: 991px) {}',
            '@media (max-width: 767px) {}',
        ]);
    });
});

function getKeyframesRules(doc: FakeDocument) {
    return collectRules(doc.styleElement.sheet).filter(isFakeKeyframesRule);
}

function getRuntimeDeclaration(doc: FakeDocument, property: string, breakpoint: 'default' | 'tablet' = 'default') {
    const runtimeLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-runtime {}');
    const elementLayer = runtimeLayer && getGroupingRule(runtimeLayer, '@layer element {}');
    const parent =
        breakpoint === 'tablet' && elementLayer
            ? getGroupingRule(elementLayer, '@media (max-width: 991px) {}')
            : elementLayer;
    return getFirstStyleRule(parent)?.style.getPropertyValue(property) || '';
}

function getRuntimeDeclarationPriority(
    doc: FakeDocument,
    property: string,
    breakpoint: 'default' | 'tablet' = 'default'
) {
    const runtimeLayer = getGroupingRule(doc.styleElement.sheet, '@layer ww-style-runtime {}');
    const elementLayer = runtimeLayer && getGroupingRule(runtimeLayer, '@layer element {}');
    const parent =
        breakpoint === 'tablet' && elementLayer
            ? getGroupingRule(elementLayer, '@media (max-width: 991px) {}')
            : elementLayer;
    return getFirstStyleRule(parent)?.style.getPropertyPriority(property) || '';
}

function getRuntimeDeclarationForComponent(doc: FakeDocument, componentId: string, property: string) {
    const rule = collectRules(doc.styleElement.sheet).find(
        (candidate): candidate is FakeStyleRule =>
            candidate instanceof FakeStyleRule &&
            candidate.selectorText.includes(`data-ww-component-id="${componentId}"`)
    );
    return rule?.style.getPropertyValue(property) || '';
}

function getGroupingRules(doc: FakeDocument) {
    return collectRules(doc.styleElement.sheet).filter(
        (rule): rule is FakeRuleContainer => rule instanceof FakeRuleContainer
    );
}

function getGeneratedLayerDeclaration(
    doc: FakeDocument,
    group: 'library' | 'section' | 'element',
    property: string,
    breakpoint: 'default' | 'tablet' = 'default'
) {
    const layer = getGroupingRule(doc.styleElement.sheet, `@layer ww-style-${group} {}`);
    const parent = breakpoint === 'tablet' && layer ? getGroupingRule(layer, '@media (max-width: 991px) {}') : layer;
    return getFirstStyleRule(parent)?.style.getPropertyValue(property) || '';
}

function getKeyframesCss(doc: FakeDocument) {
    return getKeyframesRules(doc)[0]?.cssText || '';
}

function createKeyframesVariable(): StyleDynamicVariable {
    return {
        name: '--ww-style-animation-keyframes',
        surface: {
            key: 'element:animated',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-animated',
        },
        group: 'element',
        sourceUid: 'animated',
        domain: 'style',
        property: 'animationKeyframes',
        state: 'base',
        breakpoint: 'default',
        value: { __wwtype: 'f', code: 'variables.keyframes' },
        cssProperty: 'animation-name',
        selector: '.ww-element-animated',
        kind: 'keyframes',
        keyframesName: 'ww-keyframes-element-animated-base-default',
    };
}

function createBorderVariable(): StyleDynamicVariable {
    return {
        name: '--ww-style-border',
        surface: {
            key: 'element:bordered',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-bordered',
        },
        group: 'element',
        sourceUid: 'bordered',
        domain: 'style',
        property: 'border',
        state: 'base',
        breakpoint: 'default',
        value: { __wwtype: 'f', code: 'variables.border' },
        cssProperty: 'border',
        validationProperty: 'border',
        selector: '.ww-element-bordered',
    };
}

function createBackgroundGradientVariable(): StyleDynamicVariable {
    return {
        name: '--ww-style-background-gradient',
        surface: {
            key: 'element:gradient',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-gradient',
        },
        group: 'element',
        sourceUid: 'gradient',
        domain: 'style',
        property: 'backgroundGradient',
        state: 'base',
        breakpoint: 'default',
        value: { __wwtype: 'js', code: 'return variables.gradient' },
        cssProperty: 'background',
        validationProperty: 'background',
        selector: '.ww-element-gradient',
    };
}

function createWidthVariable(): StyleDynamicVariable {
    return {
        name: '--ww-style-width',
        surface: {
            key: 'element:sized',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-sized',
        },
        group: 'element',
        sourceUid: 'sized',
        domain: 'style',
        property: 'width',
        state: 'base',
        breakpoint: 'default',
        value: { __wwtype: 'f', code: 'variables.width' },
        cssProperty: 'width',
        validationProperty: 'width',
        selector: '.ww-element-sized',
    };
}

function createLibraryVariable(libraryLayer: 'definition' | 'instance'): StyleDynamicVariable {
    return {
        name: '--ww-style-display',
        surface: {
            key: `element:library-${libraryLayer}`,
            group: 'library',
            libraryLayer,
            kind: 'element',
            selector: `.ww-element-library-${libraryLayer}`,
        },
        group: 'library',
        sourceUid: `library-${libraryLayer}`,
        domain: 'style',
        property: 'display',
        state: 'base',
        breakpoint: 'default',
        value: { __wwtype: 'f', code: 'variables.visible' },
        cssProperty: 'display',
        validationProperty: 'display',
        selector: `.ww-element-library-${libraryLayer}`,
    };
}

function getGroupingRule(container: FakeRuleContainer, ruleText: string) {
    return container.cssRules.find(
        (rule): rule is FakeRuleContainer => rule instanceof FakeRuleContainer && rule.ruleText === ruleText
    );
}

function getFirstStyleRule(container: FakeRuleContainer | null | undefined) {
    return container?.cssRules.find((rule): rule is FakeStyleRule => rule instanceof FakeStyleRule);
}

function getRuleOrder(container: FakeRuleContainer | null | undefined) {
    return container?.cssRules.map(rule => {
        if (rule instanceof FakeStyleRule) return 'style';
        if (rule instanceof FakeRuleContainer) return rule.ruleText;

        return rule.cssText;
    });
}

function collectRules(container: FakeRuleContainer): FakeCssRule[] {
    const rules: FakeCssRule[] = [];

    for (const rule of container.cssRules) {
        rules.push(rule);
        if ('cssRules' in rule) rules.push(...collectRules(rule));
    }

    return rules;
}

type FakeKeyframesRule = { cssText: string };
type FakeCssRule = FakeRuleContainer | FakeStyleRule | FakeKeyframesRule;

function isFakeKeyframesRule(rule: FakeCssRule): rule is FakeKeyframesRule {
    return 'cssText' in rule && rule.cssText.startsWith('@keyframes');
}

class FakeDocument {
    readonly styleElement = new FakeStyleElement();
    readonly head = {
        appendChild: vi.fn(),
    };
    readonly defaultView: { CSS: { supports: (property: string, value: string) => boolean } };

    constructor(supports: (property: string, value: string) => boolean = () => true) {
        this.defaultView = { CSS: { supports } };
    }

    createElement() {
        return this.styleElement;
    }
}

class FakeStyleElement {
    readonly sheet = new FakeRuleContainer();

    setAttribute() {}
    remove() {}
}

class FakeRuleContainer {
    readonly cssRules: FakeCssRule[] = [];

    constructor(readonly ruleText = '') {}

    insertRule(cssText: string, index: number) {
        let rule: FakeCssRule;
        if (cssText.startsWith('@layer') || cssText.startsWith('@media')) {
            rule = new FakeRuleContainer(cssText);
        } else if (cssText.startsWith('@keyframes')) {
            rule = { cssText };
        } else {
            rule = new FakeStyleRule(cssText.slice(0, cssText.indexOf('{')).trim());
        }

        this.cssRules.splice(index, 0, rule);
        return index;
    }

    deleteRule(index: number) {
        this.cssRules.splice(index, 1);
    }
}

class FakeStyleRule {
    readonly style = new FakeStyleDeclaration();

    constructor(readonly selectorText: string) {}
}

class FakeStyleDeclaration {
    private readonly values = new Map<string, string>();
    private readonly priorities = new Map<string, string>();

    setProperty(property: string, value: string, priority = '') {
        this.values.set(property, value);
        this.priorities.set(property, priority);
    }

    removeProperty(property: string) {
        this.values.delete(property);
        this.priorities.delete(property);
    }

    getPropertyValue(property: string) {
        return this.values.get(property) || '';
    }

    getPropertyPriority(property: string) {
        return this.priorities.get(property) || '';
    }
}
