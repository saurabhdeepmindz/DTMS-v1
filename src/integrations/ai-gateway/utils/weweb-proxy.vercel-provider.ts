import {
    AISDKError,
    NoSuchModelError,
    type EmbeddingModelV3,
    type ImageModelV3,
    type LanguageModelV3,
    type LanguageModelV3StreamPart,
    type ProviderV3,
    type RerankingModelV3,
    type SpeechModelV3,
    type TranscriptionModelV3,
} from '@ai-sdk/provider';
import type { AiOperationEnum } from './resolve-runtime.ts';

type WewebProxyProviderOptions = {
    baseUrl: string;
    headers?: Record<string, string>;
    fetchFn?: typeof fetch;
    supportsParallelCalls?: boolean;
    maxEmbeddingsPerCall?: number;
    maxImagesPerCall?: number;
};

type WewebProxyProviderCallOptions = {
    [key: string]: unknown;
    abortSignal?: AbortSignal;
    headers?: Record<string, string>;
    tools?: unknown[];
    toolChoice?: unknown;
    audio?: string | Uint8Array<ArrayBufferLike>;
};

class WewebProxyProvider implements ProviderV3 {
    readonly specificationVersion = 'v3' as const;

    private readonly providerName: string;
    private readonly proxyProvider: string;
    private readonly options: WewebProxyProviderOptions;

    constructor(proxyProvider: string, options: WewebProxyProviderOptions) {
        this.providerName = `weweb-proxy.${proxyProvider}`;
        this.proxyProvider = proxyProvider;
        this.options = options;
    }

    languageModel(modelId: string): LanguageModelV3 {
        return {
            specificationVersion: 'v3',
            provider: this.providerName,
            modelId,
            supportedUrls: {},
            doGenerate: async options => {
                const result = await this.call('text', 'generate', modelId, options);
                return result;
            },
            doStream: async options => {
                const result = await this.call('text', 'stream', modelId, options);
                if (!result) throw new Error('AI_PROXY_STREAM_EMPTY_BODY');
                return { stream: this.parseNdjsonStream(result) };
            },
        };
    }

    embeddingModel(modelId: string): EmbeddingModelV3 {
        return {
            specificationVersion: 'v3',
            provider: this.providerName,
            modelId: 'embedding',
            doEmbed: async options => {
                const result = await this.call('embedding', 'generate', modelId, options);
                return result;
            },
            maxEmbeddingsPerCall: this.options.maxEmbeddingsPerCall,
            supportsParallelCalls: this.options.supportsParallelCalls,
        };
    }

    imageModel(modelId: string): ImageModelV3 {
        return {
            specificationVersion: 'v3',
            provider: this.providerName,
            modelId,
            maxImagesPerCall: this.options.maxImagesPerCall,
            doGenerate: async options => {
                const result = await this.call('image', 'generate', modelId, options);
                return result;
            },
        };
    }

    transcriptionModel(modelId: string): TranscriptionModelV3 {
        return {
            specificationVersion: 'v3',
            provider: this.providerName,
            modelId,
            doGenerate: async options => {
                const result = await this.call('transcription', 'generate', modelId, options);
                return result;
            },
        };
    }

    speechModel(modelId: string): SpeechModelV3 {
        return {
            specificationVersion: 'v3',
            provider: this.providerName,
            modelId,
            doGenerate: async options => {
                const result = await this.call('speech', 'generate', modelId, options);
                return result;
            },
        };
    }

    rerankingModel(modelId: string): RerankingModelV3 {
        throw new NoSuchModelError({
            modelId,
            errorName: 'NoSuchModelError',
            message: `The provider ${this.providerName} does not support reranking models.`,
            modelType: 'rerankingModel',
        });
    }

    private joinUrlPath(...segments: (string | number)[]): string {
        const filtered = segments.filter(s => s !== '');
        if (filtered.length === 0) return '';

        const first = String(filtered[0]);
        const leading = first.startsWith('/') ? '/' : '';

        const joined = filtered
            .map(s => String(s).replace(/^\/+|\/+$/g, ''))
            .filter(Boolean)
            .join('/');

        return leading + joined;
    }

    private async call(
        operation: AiOperationEnum,
        operationType: 'generate',
        modelId: string,
        callOptions: WewebProxyProviderCallOptions
    ): Promise<any>;
    private async call(
        operation: AiOperationEnum,
        operationType: 'stream',
        modelId: string,
        callOptions: WewebProxyProviderCallOptions
    ): Promise<ReadableStream<Uint8Array>>;
    private async call(
        operation: AiOperationEnum,
        operationType: 'generate' | 'stream',
        modelId: string,
        callOptions: WewebProxyProviderCallOptions
    ): Promise<any | ReadableStream<Uint8Array>> {
        const {
            abortSignal,
            headers,
            tools, // Tools can't be serialized, so we extract it to avoid including it in the body
            toolChoice, // Tool choice aren't useful for the proxy, so we extract it to avoid including it in the body
            audio, // Audio may be included in the options and can be a Uint8Array which isn't serializable, so we extract it to handle it separately
            ...options
        } = callOptions;

        const serializableOptions = {
            provider: this.proxyProvider,
            modelId,
            options: {
                ...options,
                // TODO: Maybe later we should move to streaming the request body for large payloads (e.g. large audio files) instead of base64 encoding them, which can increase memory usage and latency <PLP, 2026-05-13>

                // Weweb proxy expects audio to be base64 encoded if it's included in the options
                audio: audio instanceof Uint8Array ? Buffer.from(audio).toString('base64') : audio,
            },
        };

        const body = JSON.stringify(serializableOptions);

        const fetchFn = this.options.fetchFn ?? fetch;
        const response = await fetchFn(this.joinUrlPath(this.options.baseUrl, '/ai/', operation, operationType), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: operationType === 'stream' ? 'application/x-ndjson' : 'application/json',
                ...headers,
                ...(this.options.headers || {}),
            },
            body,
            signal: abortSignal,
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => null);
            throw new AISDKError({
                name: 'AI_PROXY_REQUEST_FAILED',
                message: `Request to AI proxy provider ${this.proxyProvider} failed with status ${response.status}`,
                cause: errorBody,
            });
        }

        if (operationType === 'stream') return response.body;

        const responseBody = await response.json();
        if (responseBody?.response?.timestamp) {
            responseBody.response.timestamp = new Date(responseBody.response.timestamp);
        }

        return responseBody;
    }

    private parseNdjsonStream(body: ReadableStream<Uint8Array>): ReadableStream<LanguageModelV3StreamPart> {
        const decoder = new TextDecoder();

        let buffer = '';
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
        return new ReadableStream<LanguageModelV3StreamPart>({
            async start(controller) {
                reader = body.getReader();
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });

                        let newlineIndex = buffer.indexOf('\n');
                        while (newlineIndex !== -1) {
                            const line = buffer.slice(0, newlineIndex).trim();
                            buffer = buffer.slice(newlineIndex + 1);
                            if (line) controller.enqueue(JSON.parse(line) as LanguageModelV3StreamPart);
                            newlineIndex = buffer.indexOf('\n');
                        }
                    }

                    const trailing = buffer.trim();
                    if (trailing) controller.enqueue(JSON.parse(trailing) as LanguageModelV3StreamPart);

                    controller.close();
                } catch (error) {
                    controller.error(error);
                } finally {
                    if (reader) {
                        reader.releaseLock();
                        reader = null;
                    }
                }
            },
        });
    }
}

export function createWewebProxyProvider(provider: string, options: WewebProxyProviderOptions): ProviderV3 {
    return new WewebProxyProvider(provider, options);
}
