import { describe, expect, it } from 'vitest';

import { createAtomicStyleClassName } from './atomic';

describe('atomic style class names', () => {
    it('keeps order-sensitive shorthand and longhand bundles distinct', () => {
        const shorthandThenLonghand = [
            { property: 'margin', value: '0', priority: '' as const },
            { property: 'margin-left', value: '8px', priority: '' as const },
        ];
        const longhandThenShorthand = [...shorthandThenLonghand].reverse();

        expect(
            createAtomicStyleClassName({ group: 'element', declarations: shorthandThenLonghand })
        ).not.toBe(createAtomicStyleClassName({ group: 'element', declarations: longhandThenShorthand }));
    });
});
