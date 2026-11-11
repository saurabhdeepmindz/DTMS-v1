import type { RenderMode } from './renderMode.ts';
import { ClientIslandRenderError } from './clientIslandErrors.ts';

type RichTextStaticRenderingInput = {
    mode: RenderMode;
    rootTag: string;
    content: HTMLElement;
};

const NATIVE_RICH_TEXT_ROOT_TAGS = new Set([
    'div',
    'span',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'button',
]);

export function isNativeRichTextRootTag(tag: string): boolean {
    return NATIVE_RICH_TEXT_ROOT_TAGS.has(tag);
}

export function createNormalizedRichTextContent(text: string, document: Document): HTMLElement {
    text = text.replace(/<p>/g, '<div>');
    text = text.replace(/<\/p>/g, '</div>');
    text = text.replace(/<br><\/div>/g, '<br>');
    text = text.replace(/<\/div><div>/g, '<br>');
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/<\/div>/g, '');
    text = text.replace(/<div>/g, '');
    text = text.replace(/\u2028/g, ' ');

    const content = document.createElement('div');
    content.innerHTML = text;
    return content;
}

export function isRichTextMarkupBrowserStable(rootTag: string, content: HTMLElement): boolean {
    if (!isNativeRichTextRootTag(rootTag)) return true;

    const document = content.ownerDocument;
    const projectedRoot = document.createElement(rootTag);

    for (const child of content.childNodes) {
        if (child.nodeType === child.COMMENT_NODE) continue;
        if (child.nodeType === child.ELEMENT_NODE && (child as Element).tagName === 'SCRIPT') continue;
        projectedRoot.append(child.cloneNode(true));
    }

    const parsedContainer = document.createElement('div');
    parsedContainer.innerHTML = projectedRoot.outerHTML;

    return (
        parsedContainer.childNodes.length === 1 &&
        parsedContainer.firstElementChild?.outerHTML === projectedRoot.outerHTML
    );
}

/**
 * Vue can create invalid HTML trees through DOM APIs that an HTML parser cannot
 * reconstruct from the SSR string. Such a tree must remain client-rendered or
 * hydration will start from a different DOM shape.
 */
export function assertRichTextStaticRenderingSafe({ mode, rootTag, content }: RichTextStaticRenderingInput): void {
    if (mode !== 'ssr' || isRichTextMarkupBrowserStable(rootTag, content)) return;

    throw new ClientIslandRenderError(
        'invalid-rich-text-markup',
        `Rich text root <${rootTag}> is rewritten by the HTML parser.`
    );
}
