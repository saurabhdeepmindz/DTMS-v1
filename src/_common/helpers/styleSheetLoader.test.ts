import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { appendStyleSheet } from './styleSheetLoader';
import { loadEditorFonts } from '@/_common/editor/loadEditorFonts';
import wwApp from '@/wwLib/services/wwApp';

const windows: JSDOM[] = [];
function document() {
    const dom = new JSDOM('', { url: 'http://editor.localhost' });
    windows.push(dom);
    return dom.window.document;
}
function settle(link: HTMLLinkElement, type: 'load' | 'error') {
    link.dispatchEvent(new link.ownerDocument.defaultView!.Event(type));
}
afterEach(() => {
    for (const dom of windows.splice(0)) dom.window.close();
    vi.unstubAllGlobals();
});

describe('stylesheet CORS preference', () => {
    it('loads anonymously when requested and preserves caller attributes', async () => {
        const doc = document();
        const promise = appendStyleSheet(doc, 'https://cdn.example/font.css', {
            id: 'font',
            preferCors: true,
            attributes: { media: 'screen', nonce: 'test-nonce' },
        });
        const link = doc.querySelector('link')!;
        expect(link.crossOrigin).toBe('anonymous');
        expect(link.media).toBe('screen');
        expect(link.nonce).toBe('test-nonce');
        settle(link, 'load');
        expect(await promise).toBe(link);
    });

    it('retries once without CORS and resolves only after the fallback loads', async () => {
        const doc = document();
        const completed = vi.fn();
        const promise = appendStyleSheet(doc, 'https://third-party.example/font.css', {
            id: 'font',
            preferCors: true,
            attributes: { media: 'screen' },
        }).then(completed);
        const first = doc.querySelector('link')!;
        settle(first, 'error');
        const fallback = doc.querySelector('link')!;
        expect(fallback).not.toBe(first);
        expect(first.isConnected).toBe(false);
        expect(fallback.hasAttribute('crossorigin')).toBe(false);
        expect(fallback.id).toBe('font');
        expect(fallback.media).toBe('screen');
        expect(fallback.href).toBe(first.href);
        settle(first, 'load');
        await Promise.resolve();
        expect(completed).not.toHaveBeenCalled();
        settle(fallback, 'load');
        await promise;
        expect(completed).toHaveBeenCalledExactlyOnceWith(fallback);
        expect(doc.querySelectorAll('link')).toHaveLength(1);
    });

    it('rejects after fallback failure and removes failed links', async () => {
        const doc = document();
        const promise = appendStyleSheet(doc, '/missing.css', { id: 'missing', preferCors: true });
        const rejection = expect(promise).rejects.toThrow('Unable to load stylesheet');
        settle(doc.querySelector('link')!, 'error');
        settle(doc.querySelector('link')!, 'error');
        await rejection;
        expect(doc.querySelectorAll('link')).toHaveLength(0);
    });

    it.each([undefined, 'use-credentials'])(
        'preserves ordinary loading and explicit CORS choice %s',
        async crossOrigin => {
            const doc = document();
            const attributes = crossOrigin ? { crossOrigin } : {};
            const promise = appendStyleSheet(doc, '/explicit.css', {
                id: 'explicit',
                attributes,
                preferCors: !!crossOrigin,
            });
            expect(doc.querySelector('link')!.getAttribute('crossorigin')).toBe(crossOrigin || null);
            const rejection = expect(promise).rejects.toThrow();
            settle(doc.querySelector('link')!, 'error');
            await rejection;
            expect(doc.querySelectorAll('link')).toHaveLength(0);
        }
    );

    it('applies attributes and independent fallback to both editor documents, emitting once for the canvas', async () => {
        const front = document(),
            manager = document();
        const emit = vi.fn();
        vi.stubGlobal('wwLib', {
            getFrontDocument: () => front,
            getEditorDocument: () => manager,
            wwUtils: { getUid: () => 'shared-id' },
            $emit: emit,
        });
        const pending = wwApp.addStyleSheetToHead(
            'https://cdn.example/font.css',
            { media: 'screen' },
            { editor: true, preferCors: true }
        );
        expect(front.querySelector('link')!.crossOrigin).toBe('anonymous');
        expect(manager.querySelector('link')!.crossOrigin).toBe('anonymous');
        expect(manager.querySelector('link')!.media).toBe('screen');
        settle(manager.querySelector('link')!, 'error');
        expect(manager.querySelector('link')!.hasAttribute('crossorigin')).toBe(false);
        settle(manager.querySelector('link')!, 'load');
        expect(emit).not.toHaveBeenCalled();
        settle(front.querySelector('link')!, 'load');
        await pending;
        expect(emit).toHaveBeenCalledExactlyOnceWith('wwUtils:newStyle-shared-id');
        await wwApp.addStyleSheetToHead('https://cdn.example/font.css', {}, { editor: true, preferCors: true });
        expect(front.querySelectorAll('link')).toHaveLength(1);
        expect(manager.querySelectorAll('link')).toHaveLength(1);
        expect(emit).toHaveBeenCalledTimes(1);
    });
});

it('loads both built-in editor fonts through CORS links only once per document', () => {
    const doc = document();
    loadEditorFonts(doc);
    loadEditorFonts(doc);
    const links = [...doc.querySelectorAll('link')];
    expect(links).toHaveLength(2);
    for (const link of links) {
        expect(link.crossOrigin).toBe('anonymous');
        expect(link.href).toContain('https://fonts.googleapis.com/css2?family=');
        settle(link, 'load');
    }
});
