// @vitest-environment jsdom
import { createApp, h, nextTick, ref, withDirectives, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vDisabledReason } from './disabledReason';

let app: App;

function mount(initialReason: string | null) {
    const reason = ref<string | null>(initialReason);
    const onClick = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp({
        render: () =>
            withDirectives(h('button', { type: 'button', class: 'ww-editor-button', onClick }, 'Publish'), [
                [vDisabledReason, reason.value],
            ]),
    });
    app.mount(container);
    const button = container.querySelector('button') as HTMLButtonElement;
    const tooltip = () => {
        const id = button.getAttribute('aria-describedby');
        return id ? document.getElementById(id) : null;
    };
    return { reason, onClick, button, tooltip };
}

afterEach(() => {
    app?.unmount();
    document.body.innerHTML = '';
});

describe('v-disabled-reason', () => {
    it('keeps the control focusable but inert, and describes it with the reason', () => {
        const { button, onClick, tooltip } = mount('You need the Publish permission.');

        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.classList.contains('-disabled')).toBe(true);
        expect(tooltip()?.textContent).toBe('You need the Publish permission.');

        button.click();
        expect(onClick).not.toHaveBeenCalled();
    });

    it('shows the reason on focus and hides it on blur and Escape', () => {
        const { button, tooltip } = mount('Not allowed');

        expect(tooltip()?.hidden).toBe(true);
        button.dispatchEvent(new FocusEvent('focus'));
        expect(tooltip()?.hidden).toBe(false);
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(tooltip()?.hidden).toBe(true);
        button.dispatchEvent(new MouseEvent('mouseenter'));
        expect(tooltip()?.hidden).toBe(false);
        button.dispatchEvent(new FocusEvent('blur'));
        expect(tooltip()?.hidden).toBe(true);
    });

    it('follows the reason, and leaves the control as it was without one', async () => {
        const { button, reason, onClick, tooltip } = mount(null);
        expect(button.hasAttribute('aria-disabled')).toBe(false);

        reason.value = 'First';
        await nextTick();
        expect(tooltip()?.textContent).toBe('First');
        reason.value = 'Second';
        await nextTick();
        expect(tooltip()?.textContent).toBe('Second');

        reason.value = null;
        await nextTick();
        expect(button.hasAttribute('aria-disabled')).toBe(false);
        expect(button.hasAttribute('aria-describedby')).toBe(false);
        expect(button.classList.contains('-disabled')).toBe(false);
        expect(document.querySelector('.ww-disabled-reason-tooltip')).toBeNull();
        button.click();
        expect(onClick).toHaveBeenCalledOnce();
    });
});
