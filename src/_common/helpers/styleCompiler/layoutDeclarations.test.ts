import { describe, expect, it } from 'vitest';

import {
    createStringStyleSheetAdapter,
    createStyleCompiler,
    STATIC_STYLE_RUNTIME,
    type StyleDynamicVariable,
} from './index';
import {
    createDynamicVariableStringStyleSheetAdapter,
    createReader,
    type TestSourceData,
} from './styleCompiler.testUtils';

describe('styleCompiler layout compatibility', () => {
    it('compiles wwLayout flex CSS from content properties', () => {
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        styles: {
                            base: {
                                default: {
                                    display: 'flex',
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'row',
                                    '_ww-layout_reverse': true,
                                    '_ww-layout_justifyContent': 'space-between',
                                    '_ww-layout_alignItems': 'center',
                                    '_ww-layout_rowGap': '8px',
                                    '_ww-layout_columnGap': '12px',
                                    '_ww-layout_flexWrap': true,
                                    '_ww-layout_alignContent': 'stretch',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });

        expect(run.result).toContain('.ww-e-sZWxlbWVudEE.ww-layout');
        expect(run.result).toContain('.ww-e-sZWxlbWVudEE [data-ww-ls~="sZWxlbWVudEE"]');
        expect(run.result).not.toContain('.ww-e-sZWxlbWVudEE .ww-layout');
        expect(run.result).toContain('display: flex;');
        expect(run.result).toContain('flex-direction: row-reverse;');
        expect(run.result).toContain('justify-content: space-between;');
        expect(run.result).toContain('align-items: center;');
        expect(run.result).toContain('row-gap: 8px;');
        expect(run.result).toContain('column-gap: 12px;');
        expect(run.result).toContain('flex-wrap: wrap;');
        expect(run.result).toContain('align-content: stretch;');
    });

    it('uses the component default display when compiling wwLayout content CSS', () => {
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex', 'inline-flex'],
                        },
                        styles: {
                            base: {
                                default: {},
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'column',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });

        const layoutRule =
            run.result.match(
                /\.ww-e-sZWxlbWVudEE\.ww-layout,\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]\s*\{[^}]*\}/
            )?.[0] || '';

        expect(layoutRule).toContain('display: flex;');
        expect(layoutRule).toContain('flex-direction: column;');
    });

    it('inherits the component display when responsive wwLayout content changes without an explicit display', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex'],
                        },
                        styles: {
                            base: {
                                default: {},
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'row',
                                },
                                tablet: {
                                    '_ww-layout_flexDirection': 'column',
                                    '_ww-layout_justifyContent': 'space-between',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });
        const tabletCss = run.result.slice(run.result.indexOf('@media (max-width: 991px)'));

        expect(tabletCss).not.toContain('display: flex;');
        expect(tabletCss).toContain('flex-direction: column;');
        expect(tabletCss).toContain('justify-content: space-between;');
    });

    it('clears inherited grid layout values when a responsive slot explicitly empties them', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['grid'],
                        },
                        styles: {
                            base: {
                                default: { display: 'grid' },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-grid_columns': ['1fr', '0.5fr', '0.3fr'],
                                    '_ww-grid_rows': ['auto', '1fr'],
                                    '_ww-grid_columnGap': '10px',
                                    '_ww-grid_rowGap': '12px',
                                },
                                mobile: {
                                    '_ww-grid_columns': [],
                                    '_ww-grid_rows': [],
                                    '_ww-grid_columnGap': null,
                                    '_ww-grid_rowGap': 0,
                                    '_ww-grid_flowDirection': 'row',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });
        const mobileCss = run.result.slice(run.result.indexOf('@media (max-width: 767px)'));

        expect(mobileCss).toContain('grid-template-columns: revert-layer;');
        expect(mobileCss).toContain('grid-template-rows: revert-layer;');
        expect(mobileCss).toContain('column-gap: revert-layer;');
        expect(mobileCss).toContain('row-gap: revert-layer;');
    });

    it('clears inherited flex and table values with legacy falsy semantics', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['flexElement', 'tableElement'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    flexElement: {
                        uid: 'flexElement',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex'],
                        },
                        styles: { base: { default: { display: 'flex' } } },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_justifyContent': 'center',
                                    '_ww-layout_alignItems': 'center',
                                    '_ww-layout_alignContent': 'space-between',
                                    '_ww-layout_rowGap': '10px',
                                    '_ww-layout_columnGap': '12px',
                                    '_ww-layout_flexWrap': true,
                                },
                                tablet: {
                                    '_ww-layout_justifyContent': null,
                                    '_ww-layout_alignItems': '',
                                    '_ww-layout_rowGap': 0,
                                    '_ww-layout_columnGap': null,
                                    '_ww-layout_flexWrap': false,
                                },
                            },
                        },
                    },
                    tableElement: {
                        uid: 'tableElement',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['table'],
                        },
                        styles: { base: { default: { display: 'table' } } },
                        content: {
                            base: {
                                default: {
                                    '_ww-table_layout': 'fixed',
                                    '_ww-table_borderCollapse': 'collapse',
                                    '_ww-table_borderSpacing': '2px',
                                },
                                tablet: {
                                    '_ww-table_layout': null,
                                    '_ww-table_borderCollapse': '',
                                    '_ww-table_borderSpacing': 0,
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });
        const tabletCss = run.result.slice(run.result.indexOf('@media (max-width: 991px)'));

        expect(tabletCss).toContain('justify-content: revert-layer;');
        expect(tabletCss).toContain('align-items: revert-layer;');
        expect(tabletCss).toContain('align-content: revert-layer;');
        expect(tabletCss).toContain('row-gap: revert-layer;');
        expect(tabletCss).toContain('column-gap: revert-layer;');
        expect(tabletCss).toContain('flex-wrap: nowrap;');
        expect(tabletCss).toContain('table-layout: revert-layer;');
        expect(tabletCss).toContain('border-collapse: revert-layer;');
        expect(tabletCss).toContain('border-spacing: revert-layer;');
    });

    it('applies content classes and subclasses to wwLayout declarations', () => {
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        classIds: { base: ['classA'] },
                        subClassIds: { base: { classA: ['subA'] } },
                        styles: {
                            base: {
                                default: {
                                    display: 'flex',
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_columnGap': '16px',
                                },
                            },
                        },
                    },
                },
                classes: {
                    classA: {
                        uid: 'classA',
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_rowGap': '8px',
                                },
                            },
                        },
                        subClasses: {
                            subA: {
                                uid: 'subA',
                                content: {
                                    base: {
                                        default: {
                                            '_ww-layout_rowGap': '12px',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });

        expect(run.result).toContain('row-gap: 12px;');
        expect(run.result).toContain('column-gap: 16px;');
        expect(run.result.indexOf('row-gap: 8px;')).toBeLessThan(run.result.indexOf('row-gap: 12px;'));
    });

    it('keeps stateful class values while ignoring non-stateful content values from the same class', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: { inherits: ['ww-layout'] },
                        stateNames: ['_wwHover'],
                        classIds: { _wwHover: ['hoverClass'] },
                        nonStatefulProperties: {
                            content: [
                                '_ww-layout_flexDirection',
                                '_ww-layout_justifyContent',
                                '_ww-layout_alignItems',
                            ],
                        },
                        styles: {
                            base: {
                                default: { display: 'flex' },
                            },
                        },
                        content: {
                            base: {
                                default: { '_ww-layout_flexDirection': 'column' },
                            },
                        },
                    },
                },
                classes: {
                    hoverClass: {
                        uid: 'hoverClass',
                        styles: {
                            base: {
                                default: { opacity: '0.5' },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'row',
                                    '_ww-layout_justifyContent': 'center',
                                    '_ww-layout_alignItems': 'center',
                                    '_ww-layout_rowGap': '12px',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });

        expect(run.result).toContain('opacity: 0.5;');
        expect(run.result).toContain('row-gap: 12px;');
        expect(run.result).not.toContain('flex-direction: row;');
        expect(run.result).not.toContain('justify-content: center;');
        expect(run.result).not.toContain('align-items: center;');
    });

    it('resolves class wwLayout content in the source layout rule', () => {
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        classIds: { base: ['classA'] },
                        styles: {
                            base: {
                                default: {
                                    display: 'flex',
                                },
                            },
                        },
                    },
                },
                classes: {
                    classA: {
                        uid: 'classA',
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_rowGap': '8px',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });
        const layoutRule =
            run.result.match(
                /\.ww-e-sZWxlbWVudEE\.ww-layout,\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]\s*\{[^}]*\}/
            )?.[0] || '';

        expect(layoutRule).toContain('display: flex;');
        expect(layoutRule).toContain('row-gap: 8px;');
        expect(run.result).not.toContain('ww-style-class');
    });

    it('compiles responsive and stateful wwLayout content CSS', () => {
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        styles: {
                            base: {
                                default: {
                                    display: 'flex',
                                },
                            },
                        },
                        content: {
                            base: {
                                tablet: {
                                    '_ww-layout_rowGap': '20px',
                                },
                            },
                            _wwHover: {
                                default: {
                                    '_ww-layout_alignItems': 'flex-end',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });
        const tabletCss = run.result.slice(run.result.indexOf('@media (max-width: 991px)'));

        expect(tabletCss).toContain('.ww-e-sZWxlbWVudEE.ww-layout');
        expect(tabletCss).toContain('row-gap: 20px;');
        expect(run.result).toMatch(
            /\.ww-e-sZWxlbWVudEE\.ww-layout:where\(:hover\),\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]:where\(:hover\)/
        );
        expect(run.result).toContain('align-items: flex-end;');
    });

    it('emits effective layout declarations when responsive and state changes activate layout families', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex', 'block', 'grid', 'inline-flex'],
                        },
                        stateNames: ['_wwHover'],
                        styles: {
                            base: {
                                default: {
                                    display: 'none',
                                },
                                tablet: {
                                    display: 'flex',
                                },
                            },
                            _wwHover: {
                                default: {
                                    display: 'grid',
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'column',
                                    '_ww-layout_alignItems': 'flex-start',
                                    '_ww-grid_columns': ['1fr', '2fr'],
                                    '_ww-grid_rowGap': '12px',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });
        const tabletCss = run.result.slice(run.result.indexOf('@media (max-width: 991px)'));
        const baseLayoutRule =
            run.result.match(
                /\.ww-e-sZWxlbWVudEE\.ww-layout,\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]\s*\{[^}]*\}/
            )?.[0] || '';
        const tabletLayoutRule =
            [
                ...tabletCss.matchAll(
                    /\.ww-e-sZWxlbWVudEE\.ww-layout,\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]\s*\{[^}]*\}/g
                ),
            ]
                .map(match => match[0])
                .find(rule => rule.includes('display: flex;')) || '';
        const hoverLayoutRule =
            run.result.match(
                /\.ww-e-sZWxlbWVudEE\.ww-layout:where\(:hover\),\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]:where\(:hover\)\s*\{[^}]*\}/
            )?.[0] || '';

        expect(baseLayoutRule).toContain('display: none;');
        expect(tabletLayoutRule).toContain('display: flex;');
        expect(tabletLayoutRule).toContain('flex-direction: column;');
        expect(tabletLayoutRule).toContain('align-items: flex-start;');
        expect(hoverLayoutRule).toContain('display: grid;');
        expect(hoverLayoutRule).toContain('grid-template-columns: 1fr 2fr;');
        expect(hoverLayoutRule).toContain('row-gap: 12px;');
    });

    it('emits inherited flex declarations when a state activates the flex layout family', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex', 'block', 'grid', 'inline-flex'],
                        },
                        stateNames: ['open'],
                        styles: {
                            base: {
                                default: {
                                    display: false,
                                },
                            },
                            open: {
                                default: {
                                    display: true,
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'column',
                                    '_ww-layout_alignItems': 'flex-start',
                                    '_ww-layout_flexWrap': true,
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });
        const openLayoutRule =
            run.result.match(
                /\.ww-e-sZWxlbWVudEE\.ww-layout:where\(\[data-ww-states~="open"\]\),\n\s*\.ww-e-sZWxlbWVudEE \[data-ww-ls~="sZWxlbWVudEE"\]:where\(\[data-ww-states~="open"\]\)[^{]*\{[^}]*\}/
            )?.[0] || '';

        expect(openLayoutRule).toContain('display: flex;');
        expect(openLayoutRule).toContain('flex-direction: column;');
        expect(openLayoutRule).toContain('align-items: flex-start;');
        expect(openLayoutRule).toContain('flex-wrap: nowrap;');
    });

    it('emits display-only responsive changes on the section layout surface', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: [],
                sectionUids: ['sectionA'],
                libraryComponentIds: [],
            },
            reader: createReader({
                sections: {
                    sectionA: {
                        uid: 'sectionA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        styles: {
                            base: {
                                default: {
                                    display: 'none',
                                },
                                tablet: {
                                    display: 'flex',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });
        const tabletCss = run.result.slice(run.result.indexOf('@media (max-width: 991px)'));
        const baseLayoutRule =
            run.result.match(/\.ww-s-sc2VjdGlvbkE > \.ww-section-element\.ww-layout\s*\{[^}]*\}/)?.[0] || '';
        const tabletLayoutRule =
            [...tabletCss.matchAll(/\.ww-s-sc2VjdGlvbkE > \.ww-section-element\.ww-layout\s*\{[^}]*\}/g)]
                .map(match => match[0])
                .find(rule => rule.includes('display: flex;')) || '';

        expect(baseLayoutRule).toContain('display: none;');
        expect(tabletLayoutRule).toContain('display: flex;');
    });

    it('uses effective content pieces for responsive flex layout composites', () => {
        const stylesheet = createStringStyleSheetAdapter();
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        styles: {
                            base: {
                                default: {
                                    display: 'flex',
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'row',
                                    '_ww-layout_flexWrap': true,
                                },
                                tablet: {
                                    '_ww-layout_reverse': true,
                                    '_ww-layout_alignContent': 'space-between',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });
        const tabletCss = run.result.slice(run.result.indexOf('@media (max-width: 991px)'));

        expect(tabletCss).toContain('flex-direction: row-reverse;');
        expect(tabletCss).toContain('align-content: space-between;');
    });

    it('does not override child margins when wwLayout push-last is disabled', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex'],
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'column',
                                    '_ww-layout_pushLast': false,
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
        });

        expect(run.result).not.toContain('margin-left: unset;');
        expect(run.result).not.toContain('margin-top: unset;');
        expect(run.result).not.toContain('margin-left: auto;');
        expect(run.result).not.toContain('margin-top: auto;');
    });

    it('emits CSS variables for dynamic wwLayout content values', () => {
        const variables: StyleDynamicVariable[] = [];
        const stylesheet = createDynamicVariableStringStyleSheetAdapter(variables);
        const run = createStyleCompiler().compileStylesheet({
            scope: {
                elementUids: ['elementA'],
                sectionUids: [],
                libraryComponentIds: [],
            },
            reader: createReader({
                elements: {
                    elementA: {
                        uid: 'elementA',
                        capabilities: {
                            inherits: ['ww-layout'],
                        },
                        styles: {
                            base: {
                                default: {
                                    display: 'flex',
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_rowGap': { __wwtype: 'f', code: 'variables.gap' },
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet,
        });

        expect(run.result).not.toContain('[object Object]');
        expect(run.result).toContain('@property --ww-content-ww-layout-row-gap');
        expect(run.result).toContain('row-gap: var(--ww-content-ww-layout-row-gap);');
        expect(variables).toEqual([
            expect.objectContaining({
                name: '--ww-content-ww-layout-row-gap',
                property: '_ww-layout_rowGap',
                cssProperty: 'row-gap',
                domain: 'content',
                state: 'base',
                breakpoint: 'default',
            }),
        ]);
    });

    it('does not duplicate concrete-root push-last rules on an instance without a display override', () => {
        const definition: TestSourceData = {
            uid: 'definitionRoot',
            capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
            styles: { base: { default: { display: 'flex' } } },
            content: {
                base: {
                    default: {
                        '_ww-layout_flexDirection': 'row',
                        '_ww-layout_pushLast': true,
                    },
                },
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['instance'], sectionUids: [], libraryComponentIds: ['component'] },
            reader: createReader({
                elements: {
                    definitionRoot: definition,
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
                        emitDefaultDeclarations: false,
                        effectiveFallback: definition,
                    },
                },
                libraryComponents: { component: { rootElementUid: 'definitionRoot' } },
            }),
            stylesheet: createStringStyleSheetAdapter(),
            runtime: STATIC_STYLE_RUNTIME,
        });
        const overrideCss = run.result.slice(run.result.indexOf('@layer ww-style-layout-override'));
        const instancePushRules =
            overrideCss.match(/[^{}]*ww-e-saW5zdGFuY2U[^{}]*\{[^}]*margin-(?:left|top):[^}]*\}/g) || [];

        expect(instancePushRules).toEqual([]);
    });

    it('recomposes concrete-root responsive layout content after a library instance display override', () => {
        const definition: TestSourceData = {
            uid: 'definitionRoot',
            capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
            styles: { base: { default: { display: 'flex' } } },
            content: {
                base: {
                    default: {
                        '_ww-layout_flexDirection': 'row',
                        '_ww-layout_flexWrap': false,
                        '_ww-layout_reverse': false,
                    },
                    tablet: {
                        '_ww-layout_flexDirection': 'column',
                        '_ww-layout_flexWrap': true,
                        '_ww-layout_reverse': true,
                    },
                },
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['instance'], sectionUids: [], libraryComponentIds: ['component'] },
            reader: createReader({
                elements: {
                    definitionRoot: definition,
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
                        emitDefaultDeclarations: false,
                        styles: { base: { default: { display: true } } },
                        effectiveFallback: definition,
                    },
                },
                libraryComponents: { component: { rootElementUid: 'definitionRoot' } },
            }),
            stylesheet: createStringStyleSheetAdapter(),
            runtime: STATIC_STYLE_RUNTIME,
        });
        const instanceLayoutRules =
            run.result
                .match(/[^{}]*ww-e-saW5zdGFuY2U\.ww-layout[^{}]*\{[^}]*\}/g)
                ?.filter(rule => rule.includes('flex-direction')) || [];

        expect(instanceLayoutRules).toEqual(
            expect.arrayContaining([
                expect.stringContaining('flex-direction: row;'),
                expect.stringContaining('flex-direction: column-reverse;'),
            ])
        );
        expect(instanceLayoutRules.every(rule => rule.includes('display: flex;'))).toBe(true);
        expect(instanceLayoutRules.some(rule => rule.includes('flex-wrap: nowrap;'))).toBe(true);
    });

    it.each(['flex', 'grid', 'table'])('does not emit block-only cleanup for a %s-only layout', display => {
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['layout'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    layout: {
                        uid: 'layout',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: [display] },
                        styles: { base: { default: { display } } },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
            runtime: STATIC_STYLE_RUNTIME,
        });
        const overrideCss = run.result.slice(run.result.indexOf('@layer ww-style-layout-override'));
        const blockCleanupRules =
            overrideCss
                .match(/[^{}]*ww-element-layout[^{}]*\{[^}]*\}/g)
                ?.filter(
                    rule => rule.includes('height: revert-layer;') || rule.includes('text-align: revert-layer;')
                ) || [];

        expect(blockCleanupRules).toHaveLength(0);
    });

    it('ignores sparse library instance wrap content like the legacy root merge', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['instance'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
                        emitDefaultDeclarations: false,
                        styles: { base: { default: { display: true } } },
                        effectiveFallback: {
                            uid: 'definitionRoot',
                            styles: { base: { default: { display: 'flex' } } },
                            content: {
                                base: { default: { '_ww-layout_flexDirection': 'row' } },
                            },
                        },
                        content: { base: { default: { '_ww-layout_flexWrap': true } } },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
            runtime: STATIC_STYLE_RUNTIME,
        });
        const instanceCss = run.result.slice(run.result.indexOf('.ww-e-saW5zdGFuY2U'));

        expect(instanceCss).not.toContain('flex-wrap: wrap;');
    });

    it('ignores layout content stored on every renderless instance in a nested fallback chain', () => {
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['instance'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
                        emitDefaultDeclarations: false,
                        styles: { base: { default: { display: true } } },
                        effectiveFallback: {
                            uid: 'nestedInstance',
                            content: { base: { default: { '_ww-layout_reverse': true } } },
                            effectiveFallback: {
                                uid: 'definitionRoot',
                                styles: { base: { default: { display: 'flex' } } },
                                content: {
                                    base: { default: { '_ww-layout_flexDirection': 'row' } },
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': 'column',
                                    '_ww-layout_pushLast': true,
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createStringStyleSheetAdapter(),
            runtime: STATIC_STYLE_RUNTIME,
        });
        const instanceCss = run.result.slice(run.result.indexOf('.ww-e-saW5zdGFuY2U'));
        expect(instanceCss).toContain('flex-direction: row;');
        expect(instanceCss).not.toContain('flex-direction: column-reverse;');
        expect(instanceCss).not.toContain('margin-top: auto;');
    });

    it('keeps inherited bound layout inputs on the concrete root and ignores instance content bindings', () => {
        const variables: StyleDynamicVariable[] = [];
        const definition: TestSourceData = {
            uid: 'definitionRoot',
            capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
            styles: { base: { default: { display: 'flex' } } },
            content: {
                base: {
                    default: {
                        '_ww-layout_flexDirection': {
                            __wwtype: 'f',
                            code: 'variables.inheritedDirection',
                        },
                        '_ww-layout_pushLast': true,
                    },
                },
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['definitionRoot', 'instance'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    definitionRoot: definition,
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
                        emitDefaultDeclarations: false,
                        styles: { base: { default: { display: true } } },
                        effectiveFallback: definition,
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_reverse': { __wwtype: 'f', code: 'variables.instanceReverse' },
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createDynamicVariableStringStyleSheetAdapter(variables),
        });
        const definitionVariables = variables.filter(variable => variable.sourceUid === 'definitionRoot');
        const serializedVariables = JSON.stringify(variables);

        expect(run.result).toMatch(/\.ww-e-sZGVmaW5pdGlvblJvb3Q\.ww-layout[^}]*flex-direction: var\(/);
        expect(definitionVariables.length).toBeGreaterThan(0);
        expect(serializedVariables).toContain('variables.inheritedDirection');
        expect(serializedVariables).not.toContain('variables.instanceReverse');
        expect(variables.some(variable => variable.sourceUid === 'instance')).toBe(false);
    });

    it('does not re-evaluate concrete-root layout formulas when an instance formula gates the layout family', () => {
        const variables: StyleDynamicVariable[] = [];
        const definition: TestSourceData = {
            uid: 'definitionRoot',
            capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['flex'] },
            styles: { base: { default: { display: 'flex' } } },
            content: {
                base: {
                    default: {
                        '_ww-layout_flexDirection': {
                            __wwtype: 'f',
                            code: 'component.variables.rootDirection',
                        },
                    },
                },
            },
        };
        createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['definitionRoot', 'instance'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    definitionRoot: definition,
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex', 'block'],
                        },
                        emitDefaultDeclarations: false,
                        styles: {
                            base: {
                                default: {
                                    display: { __wwtype: 'f', code: 'variables.instanceDisplay' },
                                },
                            },
                        },
                        effectiveFallback: definition,
                    },
                },
            }),
            stylesheet: createDynamicVariableStringStyleSheetAdapter(variables),
        });
        const instanceVariables = JSON.stringify(variables.filter(variable => variable.sourceUid === 'instance'));
        const definitionVariables = JSON.stringify(
            variables.filter(variable => variable.sourceUid === 'definitionRoot')
        );

        expect(instanceVariables).toContain('variables.instanceDisplay');
        expect(instanceVariables).not.toContain('component.variables.rootDirection');
        expect(definitionVariables).toContain('component.variables.rootDirection');
    });

    it('keeps runtime-owned layout behavior out of generated CSS and dynamic manifests', () => {
        const variables: StyleDynamicVariable[] = [];
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['layout'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    layout: {
                        uid: 'layout',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['block', 'flex'],
                        },
                        states: [{ id: 'active', label: 'Active' }],
                        styles: {
                            base: { default: { display: 'block', textAlign: 'center' } },
                            active: { default: { display: 'flex' } },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': { __wwtype: 'f', code: 'direction' },
                                    '_ww-layout_reverse': { __wwtype: 'f', code: 'reverse' },
                                    '_ww-layout_pushLast': { __wwtype: 'f', code: 'pushLast' },
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createDynamicVariableStringStyleSheetAdapter(variables),
            runtime: STATIC_STYLE_RUNTIME,
        });
        const overrideCss = run.result.slice(run.result.indexOf('@layer ww-style-layout-override'));

        expect(overrideCss).not.toMatch(/(?:height|text-align|margin-left|margin-top):/);
        expect(variables.filter(variable => variable.property === '_ww-layout_pushLast')).toEqual([]);
        expect(variables.some(variable => variable.property === '_ww-layout_flexDirection')).toBe(true);
    });

    it('registers bound layout variables nested behind a bound display layout gate', () => {
        const variables: StyleDynamicVariable[] = [];
        createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['layout'], sectionUids: [], libraryComponentIds: [] },
            reader: createReader({
                elements: {
                    layout: {
                        uid: 'layout',
                        capabilities: {
                            inherits: ['ww-layout'],
                            displayAllowedValues: ['flex', 'grid'],
                        },
                        styles: {
                            base: {
                                default: {
                                    display: {
                                        __wwtype: 'f',
                                        code: 'context.component.props.display',
                                        defaultValue: 'flex',
                                    },
                                },
                            },
                        },
                        content: {
                            base: {
                                default: {
                                    '_ww-layout_flexDirection': {
                                        __wwtype: 'f',
                                        code: 'context.component.props.direction',
                                        defaultValue: 'column',
                                    },
                                    '_ww-layout_reverse': {
                                        __wwtype: 'f',
                                        code: 'context.component.props.reverse',
                                        defaultValue: false,
                                    },
                                    '_ww-layout_flexWrap': {
                                        __wwtype: 'f',
                                        code: 'context.component.props.wrap',
                                        defaultValue: false,
                                    },
                                    '_ww-layout_alignContent': 'center',
                                },
                            },
                        },
                    },
                },
            }),
            stylesheet: createDynamicVariableStringStyleSheetAdapter(variables),
            runtime: STATIC_STYLE_RUNTIME,
        });

        const outputKeys = (property: string) =>
            variables
                .filter(variable => variable.property === property && variable.outputKey)
                .map(variable => variable.outputKey)
                .sort();

        expect(outputKeys('_ww-layout_flexDirection')).toEqual([
            'as-authored',
            'column-forward',
            'column-reverse',
            'row-forward',
            'row-reverse',
        ]);
        expect(outputKeys('_ww-layout_flexWrap')).toEqual(['column', 'row-wrap']);
        expect(outputKeys('_ww-layout_alignContent')).toEqual(['when-wrapped']);
    });

    it('does not expand concrete-root states for a runtime-owned text alignment override', () => {
        const definition: TestSourceData = {
            uid: 'definitionRoot',
            capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['block', 'flex'] },
            states: [{ id: 'active', label: 'Active' }],
            styles: {
                base: { default: { display: 'block', textAlign: 'center' } },
                active: { default: { display: 'flex' } },
            },
            content: {
                active: { default: { '_ww-layout_rowGap': '12px' } },
            },
        };
        const run = createStyleCompiler().compileStylesheet({
            scope: { elementUids: ['instance'], sectionUids: [], libraryComponentIds: ['component'] },
            reader: createReader({
                elements: {
                    definitionRoot: definition,
                    instance: {
                        uid: 'instance',
                        libraryComponentBaseId: 'component',
                        capabilities: { inherits: ['ww-layout'], displayAllowedValues: ['block', 'flex'] },
                        emitDefaultDeclarations: false,
                        styles: { base: { default: { textAlign: 'right' } } },
                        effectiveFallback: definition,
                    },
                },
                libraryComponents: { component: { rootElementUid: 'definitionRoot' } },
            }),
            stylesheet: createStringStyleSheetAdapter(),
            runtime: STATIC_STYLE_RUNTIME,
        });

        expect(run.result).toMatch(/\.ww-e-sZGVmaW5pdGlvblJvb3Q\.ww-layout:where\(\[data-ww-states~="active"\]\)/);
        expect(run.result).not.toMatch(/\.ww-e-saW5zdGFuY2U[^{}]*:where\(\[data-ww-states~="active"\]\)/);
    });
});
