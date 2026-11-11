// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goToAppAccessSignedOut } from '@/_common/helpers/code/appAccessRedirects';
// @ts-expect-error Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wewebAuthFront from './weweb-auth.front.js?ww-target=front';
// @ts-expect-error Vitest resolves this test-only target query through wewebTargetBlockPlugin.
import wewebAuthEditor from './weweb-auth.front.js?ww-target=editor';

const store = vi.hoisted(() => ({ setAuthUser: vi.fn(), setAuthSession: vi.fn(), refresh: vi.fn() }));

vi.mock('better-auth/client', () => ({ createAuthClient: vi.fn() }));
vi.mock('better-auth/client/plugins', () => ({ magicLinkClient: vi.fn(), emailOTPClient: vi.fn() }));
vi.mock('@/_common/helpers/code/backendWorkflows.js', () => ({ getServerUrl: () => 'https://app.acme.com/' }));
vi.mock('@/_common/helpers/code/appAccessRedirects', () => ({ goToAppAccessSignedOut: vi.fn() }));

describe('signing out with WeWeb Auth', () => {
    let instance: { signOut: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        instance = { signOut: vi.fn().mockResolvedValue({ data: { success: true } }) };
        vi.stubGlobal('wwLib', { store: { backAuth: store } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('of an internal app ends on its signed-out page, without signing back in', async () => {
        vi.stubGlobal('wwg_designInfo', { auth: { appAccess: 'internal' } });

        let isDone = false;
        wewebAuthFront.actions.signout({ args: { redirectURL: '/home' } }, { instance }).then(() => (isDone = true));
        await vi.waitFor(() => expect(goToAppAccessSignedOut).toHaveBeenCalled());

        expect(instance.signOut).toHaveBeenCalledWith();
        // Nothing after it in the workflow runs.
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(isDone).toBe(false);
        expect(goToAppAccessSignedOut).toHaveBeenCalledOnce();
        // The session sync would be refused, signed out, and start a new sign-in.
        expect(store.setAuthSession).not.toHaveBeenCalled();
    });

    it('of a public app clears the session and follows the redirect', async () => {
        vi.stubGlobal('wwg_designInfo', { auth: { appAccess: 'public' } });

        await wewebAuthFront.actions.signout({ args: {} }, { instance });

        expect(goToAppAccessSignedOut).not.toHaveBeenCalled();
        expect(store.setAuthUser).toHaveBeenCalledWith(null);
        expect(store.setAuthSession).toHaveBeenCalledWith(null);
    });

    it('in the editor never leaves it, the app being internal or not', async () => {
        vi.stubGlobal('wwg_designInfo', { auth: { appAccess: 'internal' } });

        await wewebAuthEditor.actions.signout({ args: {} }, { instance });

        expect(goToAppAccessSignedOut).not.toHaveBeenCalled();
        expect(store.setAuthSession).toHaveBeenCalledWith(null);
    });
});
