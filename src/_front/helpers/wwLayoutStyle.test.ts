import { describe, expect, it } from 'vitest';

import { getLayoutStyleFromContent } from './wwLayoutStyle';

describe('legacy layout compatibility style', () => {
    it('restores flex layout properties and reverse semantics', () => {
        expect(
            getLayoutStyleFromContent(
                {
                    '_ww-layout_flexDirection': 'column',
                    '_ww-layout_justifyContent': 'space-between',
                    '_ww-layout_alignItems': 'center',
                    '_ww-layout_alignContent': 'stretch',
                    '_ww-layout_rowGap': '8px',
                    '_ww-layout_columnGap': '4px',
                    '_ww-layout_flexWrap': true,
                    '_ww-layout_reverse': true,
                },
                { display: 'flex', textAlign: undefined }
            )
        ).toEqual({
            display: 'flex',
            flexDirection: 'column-reverse',
            justifyContent: 'space-between',
            alignItems: 'center',
            alignContent: 'stretch',
            rowGap: '8px',
            columnGap: '4px',
            flexWrap: 'nowrap',
        });
    });

    it('restores grid and table layout properties', () => {
        expect(
            getLayoutStyleFromContent(
                {
                    '_ww-grid_flowDirection': 'column',
                    '_ww-grid_columns': ['1fr', '2fr'],
                    '_ww-grid_rows': ['auto', '1fr'],
                    '_ww-grid_columnGap': '12px',
                    '_ww-grid_rowGap': '6px',
                },
                { display: 'grid', textAlign: undefined }
            )
        ).toEqual({
            display: 'grid',
            gridAutoFlow: 'column',
            gridTemplateColumns: '1fr 2fr',
            gridTemplateRows: 'auto 1fr',
            columnGap: '12px',
            rowGap: '6px',
        });
        expect(
            getLayoutStyleFromContent(
                {
                    '_ww-table_layout': 'fixed',
                    '_ww-table_borderCollapse': 'collapse',
                    '_ww-table_borderSpacing': '2px',
                },
                { display: 'table', textAlign: undefined }
            )
        ).toEqual({
            display: 'table',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            borderSpacing: '2px',
        });
    });

    it('restores block cleanup without inventing empty text alignment', () => {
        expect(getLayoutStyleFromContent({}, { display: 'block', textAlign: 'center' })).toEqual({
            display: 'block',
            height: '100%',
            textAlign: 'center',
        });
        expect(getLayoutStyleFromContent({}, { display: 'inline-block', textAlign: '' })).toEqual({
            display: 'inline-block',
            height: '100%',
        });
    });
});
