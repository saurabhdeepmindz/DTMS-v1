import { describe, expect, it } from 'vitest';
import { consumePrerenderBootstrap } from './prerenderBootstrap';

function createDocument(attributes: Record<string, string>) {
    return {
        getElementById: (id: string) =>
            id === 'app'
                ? {
                      getAttribute: (name: string) => attributes[name] ?? null,
                      removeAttribute: (name: string) => delete attributes[name],
                  }
                : null,
    };
}

describe('pre-render bootstrap', () => {
    it('reads hydration metadata from the app mount point', () => {
        const attributes = {
            'data-ww-prerendered': 'true',
            'data-ww-client-islands': '["element:first","section:second"]',
        };

        expect(consumePrerenderBootstrap(createDocument(attributes))).toEqual({
            prerendered: true,
            clientIslandIds: ['element:first', 'section:second'],
            initialEnvironment: undefined,
        });
        expect(attributes).toEqual({});
    });

    it('ignores metadata unless the document explicitly marks the page as pre-rendered', () => {
        expect(
            consumePrerenderBootstrap(
                createDocument({
                    'data-ww-client-islands': '["element:first"]',
                })
            )
        ).toEqual({ prerendered: false, clientIslandIds: [] });
    });

    it('degrades safely when the client-island payload is malformed', () => {
        expect(
            consumePrerenderBootstrap(
                createDocument({
                    'data-ww-prerendered': 'true',
                    'data-ww-client-islands': '{invalid',
                })
            )
        ).toEqual({ prerendered: true, clientIslandIds: [], initialEnvironment: undefined });
    });

    it('rejects the whole client-island manifest instead of partially consuming invalid IDs', () => {
        expect(
            consumePrerenderBootstrap(
                createDocument({
                    'data-ww-prerendered': 'true',
                    'data-ww-client-islands': '["element:valid",""]',
                })
            )
        ).toEqual({ prerendered: true, clientIslandIds: [], initialEnvironment: undefined });
    });

    it('reads the bounded initial environment without executable inline code', () => {
        const initialEnvironment = {
            version: 1,
            randomSeed: 42,
            timestamp: 1_725_000_000_000,
            performanceNow: 12.5,
            viewport: { innerWidth: 1024, innerHeight: 768, devicePixelRatio: 1 },
        };
        const attributes = {
            'data-ww-prerendered': 'true',
            'data-ww-client-islands': '[]',
            'data-ww-initial-environment': JSON.stringify(initialEnvironment),
        };

        expect(consumePrerenderBootstrap(createDocument(attributes))).toEqual({
            prerendered: true,
            clientIslandIds: [],
            initialEnvironment,
        });
        expect(attributes).toEqual({});
    });
});
