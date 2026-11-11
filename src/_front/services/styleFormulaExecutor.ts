import { getValue } from '@/_common/helpers/code/customCode.js';
import type { FormulaExecutor } from '@/_common/helpers/formulaExecutor';
import { StaticRenderFatalError, withoutStaticBindingProjection } from '@/_front/rendering/staticRenderingContext';

/**
 * Browser implementation of the generic formula executor used by runtime style variables.
 *
 * `getValue` keeps the complete WeWeb formula context in the browser. Publisher fallback
 * evaluation uses a separate restricted interpreter and never imports this adapter.
 */
export const styleFormulaExecutor: FormulaExecutor<Record<string, unknown>> = {
    execute(formula, context) {
        try {
            return { status: 'resolved', value: getValue(formula, context) };
        } catch (error) {
            return { status: 'error', error };
        }
    },
};

/** Resolves per-instance runtime styles instead of their shared persisted static projection. */
export const prerenderStyleFormulaExecutor: FormulaExecutor<Record<string, unknown>> = {
    execute(formula, context) {
        try {
            return {
                status: 'resolved',
                value: withoutStaticBindingProjection(() =>
                    getValue(formula, createPrerenderStyleContext(context), { throwError: true })
                ),
            };
        } catch (error) {
            if (error instanceof StaticRenderFatalError) throw error;

            return { status: 'error', error };
        }
    },
};

function createPrerenderStyleContext(context: Record<string, unknown>): Record<string, unknown> {
    return new Proxy(context, {
        get(target, property, receiver) {
            if (property === 'thisInstance') {
                throw new Error('The rendered DOM instance is unavailable while prerendering runtime CSS.');
            }

            return Reflect.get(target, property, receiver);
        },
    });
}
