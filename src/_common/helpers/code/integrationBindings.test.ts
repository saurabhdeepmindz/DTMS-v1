import { describe, expect, it } from 'vitest';
import {
    buildIntegrationBindings,
    buildIntegrationConnectionLabels,
    type IntegrationBindingSource,
} from './integrationBindings';

type TestInstance = { id: string };

const RESERVED_ALIASES = ['supabase', 'xano'];

function source(
    id: string,
    integration: string,
    instance: TestInstance,
    name?: string
): IntegrationBindingSource<TestInstance> {
    return { id, name, integration, instance };
}

describe('buildIntegrationBindings', () => {
    it('keeps connection IDs authoritative when names collide', () => {
        const first = { id: 'first-instance' };
        const second = { id: 'second-instance' };

        const bindings = buildIntegrationBindings(
            [source('first', 'supabase', first, 'second'), source('second', 'xano', second, 'shared')],
            RESERVED_ALIASES
        );

        expect(bindings.first).toBe(first);
        expect(bindings.second).toBe(second);
        expect(Object.hasOwn(bindings, 'shared')).toBe(true);
    });

    it('omits duplicate and reserved name aliases', () => {
        const bindings = buildIntegrationBindings(
            [
                source('first', 'supabase', { id: 'first-instance' }, 'shared'),
                source('second', 'supabase', { id: 'second-instance' }, 'shared'),
                source('third', 'xano', { id: 'third-instance' }, 'xano'),
            ],
            RESERVED_ALIASES
        );

        expect(Object.hasOwn(bindings, 'shared')).toBe(false);
        expect(bindings.xano).toBe(bindings.third);
        expect(Object.hasOwn(bindings, 'supabase')).toBe(false);
    });

    it('adds unique names and single-connection provider aliases', () => {
        const instance = { id: 'instance' };

        const bindings = buildIntegrationBindings(
            [source('connection-id', 'supabase', instance, 'Primary database')],
            RESERVED_ALIASES
        );

        expect(bindings['connection-id']).toBe(instance);
        expect(bindings['Primary database']).toBe(instance);
        expect(bindings.supabase).toBe(instance);
    });

    it('defines special object keys without changing the bindings prototype', () => {
        const instance = { id: 'instance' };

        const bindings = buildIntegrationBindings(
            [source('connection-id', 'supabase', instance, '__proto__')],
            RESERVED_ALIASES
        );

        expect(Object.getPrototypeOf(bindings)).toBe(Object.prototype);
        expect(bindings.__proto__).toBe(instance);
    });
});

describe('buildIntegrationConnectionLabels', () => {
    it('keeps unique connection names concise', () => {
        const labels = buildIntegrationConnectionLabels([
            { id: 'connection-id', name: 'Primary database', integration: 'supabase' },
        ]);

        expect(labels.get('connection-id')).toBe('Primary database');
    });

    it('disambiguates duplicate connection names with their provider and ID', () => {
        const labels = buildIntegrationConnectionLabels([
            { id: '11111111-first', name: 'Primary database', integration: 'supabase' },
            { id: '22222222-second', name: 'Primary database', integration: 'xano' },
        ]);

        expect(labels.get('11111111-first')).toBe('Primary database (supabase · 11111111)');
        expect(labels.get('22222222-second')).toBe('Primary database (xano · 22222222)');
    });
});
