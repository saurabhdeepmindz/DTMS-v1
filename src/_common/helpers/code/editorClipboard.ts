/** Legacy copy support for editor preview when the asynchronous clipboard permission is denied. */
export function copyTextWithSelection(text: string, document: Document): boolean {
    const activeElement = document.activeElement as HTMLElement | null;
    const selection = document.getSelection();
    const ranges = [];
    for (let index = 0; index < (selection?.rangeCount || 0); index++) {
        ranges.push(selection!.getRangeAt(index).cloneRange());
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.style.cssText = 'position: fixed; top: 0; left: -9999px; opacity: 0;';

    try {
        document.body.appendChild(textarea);
        textarea.focus({ preventScroll: true });
        textarea.select();
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
        activeElement?.focus?.({ preventScroll: true });
        if (selection) {
            selection.removeAllRanges();
            for (const range of ranges) selection.addRange(range);
        }
    }
}
