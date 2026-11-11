import { describe, expect, it } from 'vitest';
import { createStyleCompiler, createStringStyleSheetAdapter } from './index';
import { createReader, type TestClassData, type TestSourceData } from './styleCompiler.testUtils';

const token = "var(--title, 400 16px/20px 'Inter', sans-serif)";

function compile(source: Partial<TestSourceData>, classes: Record<string, TestClassData> = {}) {
    const data = { uid: 'text', capabilities: { inherits: ['ww-text'] }, ...source };
    return createStyleCompiler().compileStylesheet({
        scope: { elementUids: ['text'], sectionUids: [], libraryComponentIds: [] },
        reader: createReader({ elements: { text: data }, classes }),
        stylesheet: createStringStyleSheetAdapter(),
    }).result;
}

describe('typography overrides after V17', () => {
    it.each([
        ['fontSize', '32px', 'font-size: 32px;'],
        ['fontFamily', 'Arial', 'font-family: Arial;'],
        ['fontWeight', '700', 'font-weight: 700;'],
        ['fontStyle', 'italic', 'font-style: italic;'],
        ['lineHeight', '28px', 'line-height: 28px;'],
    ])('applies %s beside a linked typography on elements', (property, value, declaration) => {
        expect(
            compile({ content: { base: { default: { '_ww-text_font': token, [`_ww-text_${property}`]: value } } } })
        ).toContain(declaration);
    });

    it('supports bound source overrides without authoring metadata', () => {
        expect(
            compile({
                content: {
                    base: {
                        default: {
                            '_ww-text_font': token,
                            '_ww-text_fontSize': { __wwtype: 'f', code: 'return variables.size;' },
                        },
                    },
                },
            })
        ).toContain('font-size: var(--ww-content-ww-text-font-size);');
    });

    it('supports same-slot overrides in responsive and state rules', () => {
        const css = compile({
            stateNames: ['hover'],
            content: {
                base: { mobile: { '_ww-text_font': token, '_ww-text_fontSize': '32px' } },
                hover: { default: { '_ww-text_font': token, '_ww-text_fontWeight': '700' } },
            },
        });
        expect(css).toContain('font-size: 32px;');
        expect(css).toContain('font-weight: 700;');
    });

    it('combines class typography overrides with element overrides', () => {
        const classes = {
            title: {
                uid: 'title',
                content: { base: { default: { '_ww-text_font': token, '_ww-text_fontWeight': '900' } } },
            },
        };
        const css = compile(
            { classIds: { base: ['title'] }, content: { base: { default: { '_ww-text_fontSize': '32px' } } } },
            classes
        );
        expect(css).toContain('font-size: 32px;');
        expect(css).toContain('font-weight: 900;');
    });
});

// Moving selected properties from an element into a class/subclass is an editor action.
describe('class authoring', () => {
    it.each(['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight'])(
        'keeps %s when moving a typography and its override into a class or subclass', property => {
            const values: Record<string, string> = { fontSize: '48px', fontFamily: 'Arial', fontWeight: '700', fontStyle: 'italic', lineHeight: '28px' };
            const content = { base: { default: { '_ww-text_font': token, [`_ww-text_${property}`]: values[property] } } };
            const before = compile({ content });
            expect(compile({ classIds: { base: ['title'] } }, { title: { uid: 'title', content } })).toBe(before);
            expect(compile(
                { classIds: { base: ['title'] }, subClassIds: { base: { title: ['variant'] } } },
                { title: { uid: 'title', subClasses: { variant: { uid: 'variant', content } } } }
            )).toBe(before);
        }
    );

    it('suppresses earlier class overrides when a later class or source replaces the font', () => {
        const classes = {
            first: { uid: 'first', content: { base: { default: { '_ww-text_font': token, '_ww-text_fontSize': '48px' } } } },
            second: { uid: 'second', content: { base: { default: { '_ww-text_font': token } } } },
        };
        expect(compile({ classIds: { base: ['first', 'second'] } }, classes)).not.toContain('font-size: 48px;');
        expect(compile({ classIds: { base: ['first'] }, content: { base: { default: { '_ww-text_font': token } } } }, classes)).not.toContain('font-size: 48px;');
    });

    it.each(['400 16px/20px Arial', { __wwtype: 'f', code: 'return variables.font;' }])(
        'preserves existing class shorthand behavior for %j', font => {
            expect(compile({ classIds: { base: ['title'] } }, {
                title: { uid: 'title', content: { base: { default: { '_ww-text_font': font, '_ww-text_fontSize': '48px' } } } },
            })).not.toContain('font-size: 48px;');
        }
    );
});
