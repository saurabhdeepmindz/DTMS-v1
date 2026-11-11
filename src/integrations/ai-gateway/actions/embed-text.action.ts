import { embed } from 'ai';
import { resolveRuntime, type ResolveRuntimeParams } from '../utils/resolve-runtime.ts';

export function buildEmbedTextAction(params: ResolveRuntimeParams) {
    function normalizeEmbeddingValue(value: unknown) {
        if (typeof value === 'string' && value) return value;
        throw new Error('AI_EMBED_VALUE_REQUIRED');
    }

    return {
        name: 'embed-text',
        handler: async ({ args }: ActionParams, context: ActionContext, helpers: any) => {
            const runtime = await resolveRuntime({ args, context, helpers }, 'embedding', {
                proxyUrl: params.proxyUrl,
                env: params.env,
                wwProjectSecret: params.wwProjectSecret,
                wwProjectId: params.wwProjectId,
                getApiKey: params.getApiKey,
            });

            const result = await embed({
                model: runtime.modelClient,
                value: normalizeEmbeddingValue(args.value),
            });

            return {
                embedding: result.embedding,
                usage: result.usage,
            };
        },
    };
}
