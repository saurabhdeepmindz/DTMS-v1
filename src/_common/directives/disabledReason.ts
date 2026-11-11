import type { Directive } from 'vue';

/**
 * `v-disabled-reason="reason"`: disables a control and says why, to everyone. A native `disabled` leaves the control
 * out of the tab order and a `title` only shows on hover, so keyboard and screen reader users never learn why. With a
 * reason, the control stays focusable but does nothing, looks disabled (`-disabled`), and shows the reason as a
 * tooltip on hover and on focus, which screen readers read as its description. Without one, it changes nothing: the
 * control's own `disabled` binding still applies.
 */

type State = {
    reason: string;
    tooltip: HTMLElement;
    previousDescribedBy: string | null;
    /** Whether it made the control focusable, to undo it. */
    addedTabindex: boolean;
    show: () => void;
    hide: () => void;
    onKeydown: (event: KeyboardEvent) => void;
    block: (event: Event) => void;
};

const STYLE_ID = 'ww-disabled-reason-style';
const GAP = 6;
const MARGIN = 8;
const states = new WeakMap<HTMLElement, State>();
let lastId = 0;

// As the editor's flyouts look.
const STYLE = `
.ww-disabled-reason-tooltip {
    position: fixed;
    z-index: 100000;
    max-width: 280px;
    padding: var(--ww-spacing-01) var(--ww-spacing-02);
    border: 1px solid var(--ww-color-border);
    border-radius: var(--ww-border-radius-01);
    background-color: var(--ww-color-bg);
    box-shadow: var(--ww-shadow-medium);
    color: var(--ww-color-content-primary);
    pointer-events: none;
    white-space: normal;
}
.ww-disabled-reason-tooltip[hidden] {
    display: none;
}
`;

function injectStyle(doc: Document) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.appendChild(style);
}

/** Under the control, or above it when there is no room below, and inside the window. */
function place(el: HTMLElement, tooltip: HTMLElement) {
    const view = el.ownerDocument.defaultView;
    if (!view) return;
    const anchor = el.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const top = below + height + MARGIN > view.innerHeight ? anchor.top - GAP - height : below;
    const centered = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(centered, MARGIN), view.innerWidth - width - MARGIN);
    tooltip.style.top = `${Math.max(top, MARGIN)}px`;
    tooltip.style.left = `${Math.max(left, MARGIN)}px`;
}

function apply(el: HTMLElement, reason: string) {
    const doc = el.ownerDocument;
    injectStyle(doc);

    const tooltip = doc.createElement('div');
    tooltip.id = `ww-disabled-reason-${++lastId}`;
    tooltip.className = 'ww-disabled-reason-tooltip body-xs';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    tooltip.textContent = reason;
    doc.body.appendChild(tooltip);

    const view = doc.defaultView;
    const hide = () => {
        tooltip.hidden = true;
        view?.removeEventListener('scroll', hide, true);
    };
    const show = () => {
        tooltip.hidden = false;
        place(el, tooltip);
        view?.addEventListener('scroll', hide, true);
    };
    const onKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !tooltip.hidden) {
            event.stopPropagation();
            hide();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    // Before the control's own handlers: they run on the same element, after the capturing ones.
    const block = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    const state: State = {
        reason,
        tooltip,
        previousDescribedBy: el.getAttribute('aria-describedby'),
        addedTabindex: false,
        show,
        hide,
        onKeydown,
        block,
    };
    states.set(el, state);

    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
    el.addEventListener('keydown', onKeydown, true);
    el.addEventListener('click', block, true);
    mark(el, state);
}

/** What Vue may overwrite when it patches the element, set again after each patch. */
function mark(el: HTMLElement, state: State) {
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('aria-describedby', state.tooltip.id);
    el.classList.add('-disabled');
    if (!el.hasAttribute('tabindex') && !isFocusable(el)) {
        el.setAttribute('tabindex', '0');
        state.addedTabindex = true;
    }
}

function isFocusable(el: HTMLElement) {
    return ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
}

function remove(el: HTMLElement) {
    const state = states.get(el);
    if (!state) return;
    state.hide();
    state.tooltip.remove();
    el.removeEventListener('mouseenter', state.show);
    el.removeEventListener('focus', state.show);
    el.removeEventListener('mouseleave', state.hide);
    el.removeEventListener('blur', state.hide);
    el.removeEventListener('keydown', state.onKeydown, true);
    el.removeEventListener('click', state.block, true);
    el.removeAttribute('aria-disabled');
    if (state.previousDescribedBy) el.setAttribute('aria-describedby', state.previousDescribedBy);
    else el.removeAttribute('aria-describedby');
    el.classList.remove('-disabled');
    if (state.addedTabindex) el.removeAttribute('tabindex');
    states.delete(el);
}

function update(el: HTMLElement, reason: string | null | undefined) {
    const state = states.get(el);
    if (!reason) return remove(el);
    if (!state) return apply(el, reason);
    if (state.reason !== reason) {
        state.reason = reason;
        state.tooltip.textContent = reason;
        if (!state.tooltip.hidden) place(el, state.tooltip);
    }
    mark(el, state);
}

export const vDisabledReason: Directive<HTMLElement, string | null | undefined> = {
    mounted(el, { value }) {
        update(el, value);
    },
    updated(el, { value }) {
        update(el, value);
    },
    beforeUnmount(el) {
        remove(el);
    },
};

declare module 'vue' {
    interface GlobalDirectives {
        vDisabledReason: typeof vDisabledReason;
    }
}
