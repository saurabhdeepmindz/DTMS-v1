// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextWithSelection } from './editorClipboard';

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
    Reflect.deleteProperty(document, 'execCommand');
});

describe('editor selection clipboard copy', () => {
    it('selects the exact text for native copying and restores focus and selection', () => {
        const input = document.createElement('button');
        const paragraph = document.createElement('p');
        paragraph.textContent = 'Selected text';
        document.body.append(input, paragraph);
        input.focus();
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
        const execCommand = vi.fn(() => {
            const textarea = document.activeElement as HTMLTextAreaElement;
            expect(textarea.tagName).toBe('TEXTAREA');
            expect(textarea.value).toBe('Copied text\nwith a second line');
            expect(textarea.selectionStart).toBe(0);
            expect(textarea.selectionEnd).toBe(textarea.value.length);
            return true;
        });
        document.execCommand = execCommand;

        expect(copyTextWithSelection('Copied text\nwith a second line', document)).toBe(true);
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(document.querySelector('textarea')).toBeNull();
        expect(document.activeElement).toBe(input);
        expect(document.getSelection()?.getRangeAt(0).toString()).toBe('Selected text');
    });

    it.each(['denied', 'throws'])('returns false and removes the temporary field when copying %s', result => {
        const input = document.createElement('input');
        document.body.append(input);
        input.focus();
        document.execCommand = vi.fn(() => {
            if (result === 'throws') throw new Error('Copy unavailable');
            return false;
        });

        expect(copyTextWithSelection('text', document)).toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
        expect(document.activeElement).toBe(input);
    });
});
