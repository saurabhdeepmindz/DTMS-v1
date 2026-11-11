import { describe, expect, it } from 'vitest';

import { getElementStyleResetClasses, IGNORE_BACKGROUND_RESET_CLASS } from './elementStyleReset';

describe('elementStyleReset', () => {
    it('keeps the background reset enabled by default', () => {
        expect(getElementStyleResetClasses(undefined)).toEqual([]);
        expect(getElementStyleResetClasses({ options: {} })).toEqual([]);
    });

    it('opts out when the component owns its background', () => {
        expect(
            getElementStyleResetClasses({
                options: { ignoredStyleProperties: ['overflow', 'background'] },
            })
        ).toEqual([IGNORE_BACKGROUND_RESET_CLASS]);
    });

    it('does not opt out for malformed ignored style property configuration', () => {
        expect(
            getElementStyleResetClasses({
                options: { ignoredStyleProperties: 'background' },
            })
        ).toEqual([]);
    });
});
