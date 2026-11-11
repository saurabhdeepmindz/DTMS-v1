import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import type { EmbeddingModel, ImageModel, LanguageModel, SpeechModel, TranscriptionModel } from 'ai';
import { normalizeRequiredModel, normalizeRequiredProvider } from './normalize.utils.ts';
import { createWewebProxyProvider } from './weweb-proxy.vercel-provider.ts';

export type AiOperationEnum = 'text' | 'embedding' | 'image' | 'speech' | 'transcription';

type RuntimeData = {
    args: any;
    context: ActionContext;
    helpers: any;
};

export type ResolveRuntimeParams = {
    proxyUrl?: string;
    env: string;
    wwProjectSecret: string;
    wwProjectId: string;
    getApiKey: (provider: string) => string | undefined;
};

export type LanguageRuntime = {
    operation: 'text';
    provider: string;
    model: string;
    modelClient: LanguageModel;
};

export type EmbeddingRuntime = {
    operation: 'embedding';
    provider: string;
    model: string;
    modelClient: EmbeddingModel;
};

export type ImageRuntime = {
    operation: 'image';
    provider: string;
    model: string;
    modelClient: ImageModel;
};

export type SpeechRuntime = {
    operation: 'speech';
    provider: string;
    model: string;
    modelClient: SpeechModel;
};

export type TranscriptionRuntime = {
    operation: 'transcription';
    provider: string;
    model: string;
    modelClient: TranscriptionModel;
};

export type Runtime = LanguageRuntime | EmbeddingRuntime | ImageRuntime | SpeechRuntime | TranscriptionRuntime;

export class UnsupportedOperationError extends Error {
    constructor(operation: string, provider: string) {
        super(`Unsupported operation "${operation}" for provider "${provider}"`);
        this.name = 'UnsupportedOperationError';
    }
}

export function getProviderApiKeyEnvName(provider: string) {
    return `AI_PROVIDER_${provider.replaceAll('-', '_').toUpperCase()}_API_KEY`;
}

export async function resolveRuntime(
    runtimeData: RuntimeData,
    operation: 'text',
    params: ResolveRuntimeParams
): Promise<LanguageRuntime>;
export async function resolveRuntime(
    runtimeData: RuntimeData,
    operation: 'embedding',
    params: ResolveRuntimeParams
): Promise<EmbeddingRuntime>;
export async function resolveRuntime(
    runtimeData: RuntimeData,
    operation: 'image',
    params: ResolveRuntimeParams
): Promise<ImageRuntime>;
export async function resolveRuntime(
    runtimeData: RuntimeData,
    operation: 'speech',
    params: ResolveRuntimeParams
): Promise<SpeechRuntime>;
export async function resolveRuntime(
    runtimeData: RuntimeData,
    operation: 'transcription',
    params: ResolveRuntimeParams
): Promise<TranscriptionRuntime>;
export async function resolveRuntime(
    { args, context, helpers }: RuntimeData,
    operation: AiOperationEnum,
    params: ResolveRuntimeParams
): Promise<Runtime> {
    const provider = normalizeRequiredProvider(args.provider, operation);
    const model = normalizeRequiredModel(args.model);

    const apiKey = params.getApiKey(provider);

    const providerOptions: Record<string, unknown> = {};
    if (!apiKey) {
        if (!params.proxyUrl) {
            throw new Error(
                `AI provider "${provider}" is not configured. Set ${getProviderApiKeyEnvName(provider)} or AI_PROXY_URL.`
            );
        }

        providerOptions.baseUrl = params.proxyUrl;
        providerOptions.headers = getHeadersForProxy({
            context,
            helpers,
            env: params.env,
            wwProjectSecret: params.wwProjectSecret,
            wwProjectId: params.wwProjectId,
        });
    } else {
        providerOptions.apiKey = apiKey;
    }

    const aiProvider = createProvider(provider, providerOptions, !apiKey);

    if (operation === 'text') {
        if (!aiProvider.languageModel) throw new UnsupportedOperationError(operation, provider);

        return {
            operation,
            provider,
            model,
            modelClient: aiProvider.languageModel(model),
        };
    }
    if (operation === 'embedding') {
        if (!aiProvider.embeddingModel) throw new UnsupportedOperationError(operation, provider);

        return {
            operation,
            provider,
            model,
            modelClient: aiProvider.embeddingModel(model),
        };
    }
    if (operation === 'image') {
        if (!aiProvider.imageModel) throw new UnsupportedOperationError(operation, provider);
        return {
            operation,
            provider,
            model,
            modelClient: aiProvider.imageModel(model),
        };
    }
    if (operation === 'speech') {
        if (!aiProvider.speechModel) throw new UnsupportedOperationError(operation, provider);
        return {
            operation,
            provider,
            model,
            modelClient: aiProvider.speechModel(model),
        };
    }
    if (operation === 'transcription') {
        if (!aiProvider.transcriptionModel) throw new UnsupportedOperationError(operation, provider);
        return {
            operation,
            provider,
            model,
            modelClient: aiProvider.transcriptionModel(model),
        };
    }

    throw new Error(`Unsupported operation: ${operation}`);
}

function createProvider(provider: string, options: any, proxy = false) {
    if (proxy) return createWewebProxyProvider(provider, options);

    switch (provider) {
        case 'openai':
            return createOpenAI(options);
        case 'anthropic':
            return createAnthropic(options);
        case 'google-gemini':
            return createGoogleGenerativeAI(options);
        case 'mistral':
            return createMistral(options);
        case 'xai':
            return createXai(options);
        case 'deepseek':
            return createDeepSeek(options);
        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

function getHeadersForProxy({
    context,
    helpers,
    env,
    wwProjectSecret,
    wwProjectId,
}: {
    context: any;
    helpers: any;
    env: string;
    wwProjectSecret: string;
    wwProjectId: string;
}) {
    return Object.fromEntries(
        Object.entries({
            'ww-project-secret': wwProjectSecret,
            'ww-project-id': wwProjectId,
            'ww-ai-env': env,
            'ww-ai-workflow-id': context.workflowDefinition?.id,
            'ww-ai-action-id': helpers.rawAction?.id,
        }).filter(([, value]) => !!value)
    ) as Record<string, string>;
}
