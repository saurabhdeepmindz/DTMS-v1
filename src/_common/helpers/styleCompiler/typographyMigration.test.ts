import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createStyleCompiler, createStringStyleSheetAdapter } from './index';
import { createReader } from './styleCompiler.testUtils';

const { normalizeStyleSourceTypographyV17, normalizeTypographyOverridesV17 } = createRequire(import.meta.url)(
    '../../../../../weweb-back/core/new/typographyOverridesV17.core.js'
);
const token = 'var(--title, 400 16px/20px Arial)';

describe('migrated typography rendering', () => {
    it.each(['mobile', 'hover_default'])('preserves the visible fallback at %s and accepts subsequent edits', slot => {
        const source = {
            content: {
                default: { '_ww-text_font': token, '_ww-text_fontSize': '64px', '_ww-text_fontWeight': '900' },
                [slot]: { '_ww-text_font': null },
            },
        };
        normalizeStyleSourceTypographyV17(source);
        const compile = () =>
            createStyleCompiler().compileStylesheet({
                scope: { elementUids: ['text'], sectionUids: [], libraryComponentIds: [] },
                reader: createReader({
                    elements: {
                        text: {
                            uid: 'text',
                            capabilities: { inherits: ['ww-text'] },
                            stateNames: ['hover'],
                            content: {
                                base: {
                                    default: source.content.default,
                                    ...(slot === 'mobile' ? { mobile: source.content[slot] } : {}),
                                },
                                ...(slot === 'hover_default' ? { hover: { default: source.content[slot] } } : {}),
                            },
                        },
                    },
                }),
                stylesheet: createStringStyleSheetAdapter(),
            }).result;
        const css = compile();
        const base = css.match(/\.ww-e-sdGV4dA\s*\{([^}]*)\}/)?.[1];
        expect(base).toContain(`font: ${token};`);
        expect(base).not.toContain('font-size: 64px;');
        expect(css).toContain('font-size: 64px;');
        expect(css).toContain('font-weight: 900;');
        source.content.default['_ww-text_fontSize'] = '32px';
        const editedBase = compile().match(/\.ww-e-sdGV4dA\s*\{([^}]*)\}/)?.[1];
        expect(editedBase).toContain('font-size: 32px;');
        expect(editedBase).not.toContain('font-weight: 900;');
    });
});

it('preserves class/subclass fallbacks on mobile and states, then renders newly authored class overrides', () => {
    const source = {
        _state: { classes: { default: ['title'] }, subClasses: { default: { title: ['variant'] } } },
        content: { hover_default: { '_ww-text_font': '' } } as Record<string, Record<string, unknown>>,
    };
    const styleClass = {
        id: 'title',
        content: { default: { '_ww-text_font': token, '_ww-text_fontWeight': 300 }, mobile: { '_ww-text_font': null } },
        subClasses: { variant: { content: { default: { '_ww-text_font': token, '_ww-text_lineHeight': '1.7em' } } } },
    };
    normalizeTypographyOverridesV17({ wwObjects: [source], library: { classes: [styleClass] } });
    const compile = () => createStyleCompiler().compileStylesheet({
        scope: { elementUids: ['text'], sectionUids: [], libraryComponentIds: [] },
        reader: createReader({
            elements: { text: {
                uid: 'text', capabilities: { inherits: ['ww-text'] }, stateNames: ['hover'],
                classIds: { base: ['title'] }, subClassIds: { base: { title: ['variant'] } },
                content: { base: { mobile: source.content.mobile }, hover: { default: source.content.hover_default } },
            } },
            classes: { title: {
                uid: 'title', content: { base: styleClass.content },
                subClasses: { variant: { uid: 'variant', content: { base: styleClass.subClasses.variant.content } } },
            } },
        }),
        stylesheet: createStringStyleSheetAdapter(),
    }).result;
    const css = compile();
    const base = css.match(/\.ww-e-sdGV4dA\s*\{([^}]*)\}/)?.[1];
    expect(base).toContain(`font: ${token};`);
    expect(base).not.toContain('font-weight: 300;');
    expect(base).not.toContain('line-height: 1.7em;');
    for (const rule of css.matchAll(/\.ww-e-sdGV4dA[^{}]*\{([^}]*)\}/g)) {
        if (rule[1] === base) continue;
        expect(rule[1]).toContain('font-weight: 300;');
        expect(rule[1]).toContain('line-height: 1.7em;');
    }
    styleClass.subClasses.variant.content.default['_ww-text_lineHeight'] = '2em';
    expect(compile().match(/\.ww-e-sdGV4dA\s*\{([^}]*)\}/)?.[1]).toContain('line-height: 2em;');
});
