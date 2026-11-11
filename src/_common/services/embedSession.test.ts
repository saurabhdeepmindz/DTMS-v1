// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({ default: { post: http.post } }));

/*  The embed session of the app shown in ChatGPT starts from the one-time code in its URL only: kept nowhere else, it
    cannot be picked up by a frame of the app that another ChatGPT app opens in the same tab. */

const token = (lifetimeSeconds = 3600) => {
    const iat = Math.floor(Date.now() / 1000);
    return `header.${btoa(JSON.stringify({ iat, exp: iat + lifetimeSeconds }))}.signature`;
};

const load = async (hash: string) => {
    vi.resetModules();
    window.history.replaceState(null, '', `/workspaces${hash}`);
    return import('./embedSession.js');
};

beforeEach(() => {
    http.post.mockReset();
    sessionStorage.clear();
    vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it('starts from the code in the URL, which leaves it right away', async () => {
    const embedToken = token();
    http.post.mockResolvedValue({ data: { token: embedToken } });
    const session = await load('#wwEmbedCode=abc&tab=1');

    expect(await session.startEmbedSession()).toBe(true);
    expect(http.post).toHaveBeenCalledWith(
        expect.stringMatching(/\/v2\/users\/embed\/session$/),
        { code: 'abc' },
        { withCredentials: false }
    );
    expect(session.getEmbedToken()).toBe(embedToken);
    expect(window.location.hash).toBe('#tab=1');
});

it('keeps the token in memory only, and clears the one earlier versions stored', async () => {
    sessionStorage.setItem('ww-embed-token', token());
    http.post.mockResolvedValue({ data: { token: token() } });
    const session = await load('#wwEmbedCode=abc');

    expect(await session.startEmbedSession()).toBe(true);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
});

it('does not start without a code, even with a token stored by an earlier version', async () => {
    sessionStorage.setItem('ww-embed-token', token());
    const session = await load('');

    expect(await session.startEmbedSession()).toBe(false);
    expect(session.isEmbedSession()).toBe(false);
    expect(http.post).not.toHaveBeenCalled();
});

it('does not start with a code already spent: the MCP app page hands a fresh one', async () => {
    http.post.mockRejectedValue({ response: { status: 401 } });
    const session = await load('#wwEmbedCode=spent');

    expect(await session.startEmbedSession()).toBe(false);
    expect(session.isEmbedSession()).toBe(false);
});

it('renews the token ahead of its expiry', async () => {
    const renewed = token();
    http.post.mockResolvedValueOnce({ data: { token: token() } }).mockResolvedValueOnce({ data: { token: renewed } });
    const session = await load('#wwEmbedCode=abc');
    await session.startEmbedSession();

    await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
    expect(http.post).toHaveBeenLastCalledWith(
        expect.stringMatching(/\/v2\/users\/embed\/refresh$/),
        {},
        expect.anything()
    );
    expect(session.getEmbedToken()).toBe(renewed);
});
