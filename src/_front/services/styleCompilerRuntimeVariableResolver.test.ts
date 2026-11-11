import { describe, expect, it } from 'vitest';

import type { FormulaExecutor } from '@/_common/helpers/formulaExecutor';
import type { StyleDynamicVariable } from '@/_common/helpers/styleCompiler';
import {
    decodeStyleRuntimeManifest,
    encodeStyleRuntimeManifest,
} from '@/_common/helpers/styleCompiler/runtimeManifest';
import {
    resolveStyleCompilerRuntimeVariable,
    resolveStyleCompilerRuntimeVariableResult,
} from './styleCompilerRuntimeVariableResolver';

describe('resolveStyleCompilerRuntimeVariable', () => {
    it('activates a positioned offset only while its position binding is supported', () => {
        const values = new Map<string, unknown>([
            ['position', 'absolute'],
            ['bottom', '60px'],
        ]);
        const executor = createExecutor(values);
        const variable = createPositionedVariable('bottom', { __wwtype: 'f', code: 'bottom' });

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('60px');

        values.set('position', 'relative');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();

        values.set('position', undefined);
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();
    });

    it('reuses the condition result when the condition is also the variable value', () => {
        const positionFormula = { __wwtype: 'f', code: 'position' };
        const bottomFormula = { __wwtype: 'f', code: 'bottom' };
        const executions: unknown[] = [];
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute(formula) {
                executions.push(formula);
                return { status: 'resolved', value: formula === positionFormula ? 'fixed' : '60px' };
            },
        };
        const executionResults = new Map();
        const positionVariable = createPositionedVariable('position', positionFormula, positionFormula);
        const bottomVariable = createPositionedVariable('bottom', bottomFormula, positionFormula);

        expect(
            resolveStyleCompilerRuntimeVariable({
                variable: positionVariable,
                context: {},
                executor,
                executionResults,
            })
        ).toBe('fixed');
        expect(
            resolveStyleCompilerRuntimeVariable({
                variable: bottomVariable,
                context: {},
                executor,
                executionResults,
            })
        ).toBe('60px');
        expect(executions).toEqual([positionFormula, bottomFormula]);
    });

    it('requires every runtime condition to match', () => {
        const values = new Map<string, unknown>([
            ['direction', 'column'],
            ['alignment', 'stretch'],
        ]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('align-self', 'center'),
            condition: [
                { value: { __wwtype: 'f', code: 'direction' }, allowedValues: ['column'] },
                { value: { __wwtype: 'f', code: 'alignment' }, allowedValues: ['stretch'] },
            ],
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('center');

        values.set('direction', 'row');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();
    });

    it('supports runtime conditions that exclude exact legacy values', () => {
        const values = new Map<string, unknown>([['direction', 'column']]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('margin-left', 'auto'),
            condition: {
                value: { __wwtype: 'f', code: 'direction' },
                allowedValues: ['row', 'row-reverse', 'column-reverse'],
                disallowedValues: ['column'],
            },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();

        values.set('direction', 'row-reverse');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('auto');

        values.set('direction', undefined);
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('auto');
    });

    it('supports truthy runtime conditions', () => {
        const values = new Map<string, unknown>([['alignment', undefined]]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('width', 'revert-layer'),
            condition: { value: { __wwtype: 'f', code: 'alignment' }, truthy: true },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();

        values.set('alignment', 'center');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('revert-layer');
    });

    it('normalizes display conditions before selecting a layout family', () => {
        const displayFormula = { __wwtype: 'f', code: 'display' };
        const values = new Map<string, unknown>([['display', true]]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('justify-content', 'center'),
            condition: {
                value: displayFormula,
                allowedValues: ['flex', 'inline-flex'],
                valueNormalizer: {
                    type: 'display',
                    allowedValues: ['flex', 'block', 'grid', 'inline-flex'],
                    restrictToAllowedValues: true,
                },
            },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('center');

        values.set('display', 'grid');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();

        values.set('display', false);
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();
    });

    it('marks resolved undefined library instance overrides as empty without changing explicit visibility values', () => {
        const displayFormula = { __wwtype: 'f', code: 'display' };
        const values = new Map<string, unknown>([['display', undefined]]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('display', displayFormula),
            condition: undefined,
            valueNormalizer: {
                type: 'display',
                allowedValues: ['flex', 'inline-flex'],
                restrictToAllowedValues: true,
            },
            omitWhenUndefined: true,
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });

        values.set('display', false);
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: 'none',
        });

        values.set('display', true);
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: 'flex',
        });
    });

    it('keeps bound heights dynamic and clears empty runtime values', () => {
        const heightFormula = { __wwtype: 'f', code: 'height' };
        const values = new Map<string, unknown>([['height', '320px']]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('height', heightFormula),
            condition: undefined,
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: '320px',
        });

        values.set('height', null);
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });

        values.set('height', undefined);
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });

        values.set('height', '');
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });
    });

    it.each([undefined, null, false, '', 0, 'auto'])('applies the legacy component-size fallback to %j', value => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const executor = createExecutor(new Map([['width', value]]));
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size', fallbackValue: '100%' },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: '100%',
        });
    });

    it('distinguishes an undefined library width override from an explicit automatic size', () => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const values = new Map<string, unknown>([['width', undefined]]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size', fallbackValue: 'auto' },
            omitWhenUndefined: true,
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });

        values.set('width', 'auto');
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: 'auto',
        });
    });

    it('uses section sizing for an explicit automatic direct-instance width but not for undefined', () => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const values = new Map<string, unknown>([['width', undefined]]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size' },
            omitWhenUndefined: true,
            runtimeFallback: {
                type: 'when-all-empty',
                dependencies: [],
                value: 'var(--ww-section-root-auto-width, auto)',
            },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });

        values.set('width', 'auto');
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: 'var(--ww-section-root-auto-width, auto)',
        });
    });

    it.each([
        ['0px', '0px'],
        [320, '320px'],
        ['calc(100% - 20px)', 'calc(100% - 20px)'],
    ])('preserves the explicit component-size value %j', (value, expected) => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const executor = createExecutor(new Map([['width', value]]));
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size', fallbackValue: '100%' },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe(expected);
    });

    it.each([undefined, null, false, '', 0, 'auto'])(
        'clears a legacy component size without a configured fallback for %j',
        value => {
            const widthFormula = { __wwtype: 'f', code: 'width' };
            const executor = createExecutor(new Map([['width', value]]));
            const variable = {
                ...createPositionedVariable('width', widthFormula),
                condition: undefined,
                valueNormalizer: { type: 'component-size' },
            } satisfies StyleDynamicVariable;

            expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
                status: 'empty',
            });
        }
    );

    it.each([undefined, null, false, '', 0])('applies a legacy falsy fallback to %j', value => {
        const heightFormula = { __wwtype: 'f', code: 'height' };
        const executor = createExecutor(new Map([['height', value]]));
        const variable = {
            ...createPositionedVariable('height', heightFormula),
            condition: undefined,
            valueNormalizer: { type: 'falsy-fallback', fallbackValue: 'auto' },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('auto');
    });

    it.each([
        { status: 'unresolved', reason: 'missing-context' } as const,
        { status: 'error', error: new Error('Formula failed') } as const,
    ])('keeps the static fallback when execution returns $status', execution => {
        const variable = {
            ...createPositionedVariable('border', { __wwtype: 'f', code: 'border' }),
            condition: undefined,
        } satisfies StyleDynamicVariable;
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute: () => execution,
        };

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'unresolved',
        });
    });

    it('uses the section-root width only while both bound width and alignment are empty', () => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const alignFormula = { __wwtype: 'f', code: 'alignment' };
        const values = new Map<string, unknown>([
            ['width', undefined],
            ['alignment', undefined],
        ]);
        const executor = createExecutor(values);
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size' },
            runtimeFallback: {
                type: 'when-all-empty',
                dependencies: [alignFormula],
                value: 'var(--ww-section-root-auto-width, revert-layer)',
            },
        } satisfies StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe(
            'var(--ww-section-root-auto-width, revert-layer)'
        );

        values.set('alignment', 'flex-start');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();

        values.set('width', 320);
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('320px');

        values.set('width', 0);
        values.set('alignment', undefined);
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe(
            'var(--ww-section-root-auto-width, revert-layer)'
        );

        values.set('width', 'auto');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe(
            'var(--ww-section-root-auto-width, revert-layer)'
        );
    });

    it('preserves all-empty dependency semantics through JSON manifest transport', () => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const alignFormula = { __wwtype: 'f', code: 'alignment' };
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size' },
            runtimeFallback: {
                type: 'when-all-empty',
                dependencies: [alignFormula],
                value: 'var(--ww-section-root-auto-width, revert-layer)',
            },
        } satisfies StyleDynamicVariable;
        const manifest = JSON.parse(JSON.stringify(encodeStyleRuntimeManifest([variable])));
        const [transportedVariable] = decodeStyleRuntimeManifest(manifest) || [];
        const executions: string[] = [];
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute(formula) {
                const code = (formula as { code: string }).code;
                executions.push(code);
                return { status: 'resolved', value: code === 'width' ? 'auto' : undefined };
            },
        };

        expect(transportedVariable).toBeDefined();
        expect(resolveStyleCompilerRuntimeVariable({ variable: transportedVariable, context: {}, executor })).toBe(
            'var(--ww-section-root-auto-width, revert-layer)'
        );
        expect(executions).toEqual(['width', 'alignment']);
    });

    it('keeps the static fallback when an all-empty dependency is unresolved', () => {
        const widthFormula = { __wwtype: 'f', code: 'width' };
        const alignFormula = { __wwtype: 'f', code: 'alignment' };
        const variable = {
            ...createPositionedVariable('width', widthFormula),
            condition: undefined,
            valueNormalizer: { type: 'component-size' },
            runtimeFallback: {
                type: 'when-all-empty',
                dependencies: [alignFormula],
                value: 'var(--ww-section-root-auto-width, revert-layer)',
            },
        } satisfies StyleDynamicVariable;
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute(formula) {
                if (formula === widthFormula) return { status: 'resolved', value: undefined };
                return { status: 'unresolved', reason: 'missing-context' };
            },
        };

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'unresolved',
        });
    });

    it('uses the legacy top offset when every runtime offset resolves empty', () => {
        const bottomFormula = { __wwtype: 'f', code: 'bottom' };
        const executor = createExecutor(
            new Map([
                ['position', 'absolute'],
                ['bottom', undefined],
            ])
        );
        const variable = createFallbackTopVariable(bottomFormula);

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('0px');
    });

    it('resolves an ordered fallback only after the primary value resolves empty', () => {
        const placementFormula = { __wwtype: 'f', code: 'placement' };
        const spanFormula = { __wwtype: 'f', code: 'span' };
        const values = new Map<string, unknown>([
            ['placement', '2 / 8'],
            ['span', '6'],
        ]);
        const executions: unknown[] = [];
        const baseExecutor = createExecutor(values);
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute(formula, context) {
                executions.push(formula);
                return baseExecutor.execute(formula, context);
            },
        };
        const variable = {
            ...createPositionedVariable('gridColumn', placementFormula),
            condition: undefined,
            valueNormalizer: { type: 'empty-if-falsy' },
            runtimeFallback: {
                type: 'when-empty',
                value: spanFormula,
                valueNormalizer: { type: 'prefix-if-truthy', prefix: 'span ' },
            },
            cssProperty: 'grid-column',
        } as StyleDynamicVariable;

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: '2 / 8',
        });
        expect(executions).toEqual([placementFormula]);

        executions.length = 0;
        values.set('placement', '');
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'value',
            cssValue: 'span 6',
        });
        expect(executions).toEqual([placementFormula, spanFormula]);

        values.set('span', '');
        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });
    });

    it('does not use the legacy top offset when another runtime offset resolves', () => {
        const bottomFormula = { __wwtype: 'f', code: 'bottom' };
        const executor = createExecutor(
            new Map([
                ['position', 'absolute'],
                ['bottom', '60px'],
            ])
        );
        const variable = createFallbackTopVariable(bottomFormula);

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();
    });

    it('does not resolve offset fallbacks while the position condition is inactive', () => {
        const positionFormula = { __wwtype: 'f', code: 'position' };
        const bottomFormula = { __wwtype: 'f', code: 'bottom' };
        const executions: unknown[] = [];
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute(formula) {
                executions.push(formula);
                return { status: 'resolved', value: formula === positionFormula ? 'relative' : undefined };
            },
        };
        const variable = createFallbackTopVariable(bottomFormula, positionFormula);

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBeNull();
        expect(executions).toEqual([positionFormula]);
    });

    it('keeps unresolved conditions distinct from resolved inactive conditions', () => {
        const conditionFormula = { __wwtype: 'f', code: 'position' };
        const variable = createPositionedVariable('top', { __wwtype: 'f', code: 'top' }, conditionFormula);
        const executor: FormulaExecutor<Record<string, unknown>> = {
            execute: () => ({ status: 'unresolved', reason: 'missing-context' }),
        };

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'unresolved',
        });
    });

    it('preserves legacy animation iteration truthiness for numeric and string zero', () => {
        const formula = { __wwtype: 'f', code: 'iterations' };
        const values = new Map<string, unknown>([['iterations', 0]]);
        const executor = createExecutor(values);
        const variable = createAnimationIterationVariable(formula);

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('infinite');

        values.set('iterations', '0');
        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe('0');
    });

    it('serializes a formula-bound background image as a CSS image URL', () => {
        const formula = { __wwtype: 'f', code: 'backgroundImage' };
        const executor = createExecutor(new Map([['backgroundImage', 'designs/project/sections/hero.png']]));
        const variable = createBackgroundImageVariable(formula);

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe(
            "url('https://cdn.weweb-staging.io/designs/project/sections/hero.png')"
        );
    });

    it.each([
        ['https://cdn.example.com/hero.png', "url('https://cdn.example.com/hero.png')"],
        ['data:image/png;base64,AAAA', "url('data:image/png;base64,AAAA')"],
        ['blob:https://example.com/image-id', "url('blob:https://example.com/image-id')"],
        ['linear-gradient(red, blue)', 'linear-gradient(red, blue)'],
        ["url('/hero.png')", "url('/hero.png')"],
        ['var(--hero-image)', 'var(--hero-image)'],
        ['none', 'none'],
    ])('preserves valid formula-bound background image syntax for %s', (value, expected) => {
        const formula = { __wwtype: 'f', code: 'backgroundImage' };
        const executor = createExecutor(new Map([['backgroundImage', value]]));
        const variable = createBackgroundImageVariable(formula);

        expect(resolveStyleCompilerRuntimeVariable({ variable, context: {}, executor })).toBe(expected);
    });

    it('rejects declarations appended to a formula-bound background image', () => {
        const formula = { __wwtype: 'f', code: 'backgroundImage' };
        const executor = createExecutor(new Map([['backgroundImage', "url('/hero.png'); color: red"]]));
        const variable = createBackgroundImageVariable(formula);

        expect(resolveStyleCompilerRuntimeVariableResult({ variable, context: {}, executor })).toEqual({
            status: 'empty',
        });
    });
});

function createExecutor(values: Map<string, unknown>): FormulaExecutor<Record<string, unknown>> {
    return {
        execute(formula) {
            if (!formula || typeof formula !== 'object' || !('code' in formula)) {
                return { status: 'resolved', value: formula };
            }

            return { status: 'resolved', value: values.get(`${formula.code}`) };
        },
    };
}

function createPositionedVariable(
    property: string,
    value: unknown,
    condition = { __wwtype: 'f', code: 'position' }
): StyleDynamicVariable {
    return {
        name: `--ww-style-${property}-positioned`,
        surface: {
            key: 'element:elementA',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-elementA',
        },
        group: 'element',
        sourceUid: 'elementA',
        domain: 'style',
        property,
        state: 'base',
        breakpoint: 'default',
        value,
        condition: {
            value: condition,
            allowedValues: ['absolute', 'fixed', 'sticky'],
        },
        cssProperty: property,
        selector: '.ww-element-elementA',
    };
}

function createFallbackTopVariable(
    bottomFormula: unknown,
    positionFormula = { __wwtype: 'f', code: 'position' }
): StyleDynamicVariable {
    return {
        ...createPositionedVariable('top', undefined, positionFormula),
        name: '--ww-style-top-positioned-fallback',
        runtimeFallback: {
            type: 'when-all-empty',
            dependencies: [undefined, bottomFormula, undefined],
            value: '0px',
        },
    };
}

function createAnimationIterationVariable(value: unknown): StyleDynamicVariable {
    return {
        name: '--ww-style-animation-iteration-count',
        surface: {
            key: 'element:animated',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-animated',
        },
        group: 'element',
        sourceUid: 'animated',
        domain: 'style',
        property: 'animationIterationCount',
        state: 'base',
        breakpoint: 'default',
        value,
        valueNormalizer: { type: 'falsy-fallback', fallbackValue: 'infinite' },
        cssProperty: 'animation-iteration-count',
        selector: '.ww-element-animated',
    };
}

function createBackgroundImageVariable(value: unknown): StyleDynamicVariable {
    return {
        name: '--ww-style-background-image',
        surface: {
            key: 'element:hero',
            group: 'element',
            kind: 'element',
            selector: '.ww-element-hero',
        },
        group: 'element',
        sourceUid: 'hero',
        domain: 'style',
        property: 'backgroundImage',
        state: 'base',
        breakpoint: 'default',
        value,
        valueNormalizer: {
            type: 'background-image',
            assetBaseUrl: 'https://cdn.weweb-staging.io/',
        },
        cssProperty: 'background-image',
        selector: '.ww-element-hero',
    };
}
