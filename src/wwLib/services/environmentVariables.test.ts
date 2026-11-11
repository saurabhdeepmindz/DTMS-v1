import { describe, expect, it } from 'vitest';
import { createEnvironmentVariablesContext } from './environmentVariables';

describe('createEnvironmentVariablesContext', () => {
    it('resolves a legacy name with any casing', () => {
        const context = createEnvironmentVariablesContext(
            [{ name: 'OpenAI', editorValue: 'editor-value' }],
            'editor'
        );

        expect(context.OpenAI).toBe('editor-value');
        expect(context.OPENAI).toBe('editor-value');
        expect(context.openai).toBe('editor-value');
    });

    it('prefers exact names and does not guess when legacy names collide', () => {
        const context = createEnvironmentVariablesContext(
            [
                { name: 'OpenAI', productionValue: 'legacy-value' },
                { name: 'OPENAI', productionValue: 'canonical-value' },
            ],
            'production'
        );

        expect(context.OpenAI).toBe('legacy-value');
        expect(context.OPENAI).toBe('canonical-value');
        expect(context.openai).toBeUndefined();
    });
});
