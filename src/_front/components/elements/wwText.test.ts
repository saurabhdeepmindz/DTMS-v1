import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const richTextRendering = vi.hoisted(() => ({
    createNormalizedRichTextContent: vi.fn((text: string) => {
        text.replace(/<p>/g, '<div>');
        return {};
    }),
    isRichTextMarkupBrowserStable: vi.fn(() => true),
}));

vi.mock('@/_front/rendering/richTextStaticRendering', () => richTextRendering);

// @ts-ignore Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wwText from './wwText.vue?ww-target=editor';

describe('wwText rich text validation', () => {
    beforeEach(() => {
        richTextRendering.createNormalizedRichTextContent.mockClear();
        richTextRendering.isRichTextMarkupBrowserStable.mockClear();
        vi.stubGlobal('wwLib', withStoreRegistry({
            wwLang: {
                getText: vi.fn(value => value.en),
            },
        }));
    });

    it('validates the active translation when inline editing emits localized text', () => {
        const localizedText = {
            en: '<p>Updated text</p>',
            fr: '<p>Texte mis a jour</p>',
        };
        const updateContent = vi.fn();
        const context = {
            tag: 'div',
            hasWarnedAboutBrowserUnstableMarkup: false,
            isTextBound: false,
            updateContent,
            warnAboutBrowserUnstableMarkup: wwText.methods.warnAboutBrowserUnstableMarkup,
        };

        expect(() => wwText.methods.updateText.call(context, localizedText)).not.toThrow();
        expect(richTextRendering.createNormalizedRichTextContent).toHaveBeenCalledWith('<p>Updated text</p>', document);
        expect(updateContent).toHaveBeenCalledWith({ '_ww-text_text': localizedText });
    });
});
