import { generateText, jsonSchema, Output, streamText, type ModelMessage, type Schema, type TextStreamPart } from 'ai';
import { resolveRuntime, type LanguageRuntime, type ResolveRuntimeParams } from '../utils/resolve-runtime.ts';
import {
    normalizeMessages,
    normalizeOptionalNonNegativeInteger,
    normalizeOptionalNumber,
    normalizeOptionalPositiveInteger,
    normalizeOptionalString,
} from '../utils/normalize.utils.ts';

const STRUCTURED_STREAM_CHUNK_KEY = '__wwStructuredStreamChunk';

export function buildGenerateTextAction(params: ResolveRuntimeParams) {
    function normalizeOutputJsonSchema(schema: unknown) {
        let parsedSchema = schema;
        if (typeof schema === 'string') {
            try {
                parsedSchema = JSON.parse(schema);
            } catch {
                throw new Error('AI_SCHEMA_INVALID');
            }
        }
        if (!parsedSchema || typeof parsedSchema !== 'object' || Array.isArray(parsedSchema))
            throw new Error('AI_SCHEMA_INVALID');
        return parsedSchema as any;
    }

    function normalizeOutputOptions(options: unknown) {
        if (!options || typeof options !== 'object' || !Array.isArray(options))
            throw new Error('AI_OUTPUT_OPTIONS_INVALID');
        return options as string[];
    }

    function getOutputSettings(args: any) {
        if (args._outputType === 'text') return undefined;

        const name = normalizeOptionalString(args.output?.name);
        const description = normalizeOptionalString(args.output?.description);

        const outputSettings: { name?: string; description?: string } = {};

        if (name) outputSettings.name = name;
        if (description) outputSettings.description = description;

        switch (args._outputType) {
            case 'json':
                return Output.json(outputSettings);

            case 'object':
                if (!args.output?.schema) throw new Error('AI_OUTPUT_SCHEMA_REQUIRED');
                const schema = normalizeOutputJsonSchema(args.output.schema);
                return Output.object({ schema: jsonSchema(schema), ...outputSettings });

            case 'array':
                if (!args.output?.element) throw new Error('AI_OUTPUT_ELEMENT_SCHEMA_REQUIRED');
                const elementSchema = normalizeOutputJsonSchema(args.output.element);
                return Output.array({ element: jsonSchema(elementSchema), ...outputSettings });

            case 'choices':
                if (!args.output?.options) throw new Error('AI_OUTPUT_OPTIONS_REQUIRED');

                const options = normalizeOutputOptions(args.output.options);
                return Output.choice({ options, ...outputSettings });

            default:
                console.warn(`Unknown output type: ${args._outputType}, defaulting to text output`);
                return undefined;
        }
    }

    function getTextGenerationSettings(args: any, provider: string) {
        const settings: {
            system?: string;
            temperature?: number;
            maxOutputTokens?: number;
            providerOptions?: unknown;
            output?: unknown;
        } = {};

        const system = normalizeOptionalString(args.system);
        const temperature = normalizeOptionalNumber(args.temperature);
        const maxOutputTokens = normalizeOptionalPositiveInteger(args.maxOutputTokens);
        const providerOptions = getTextGenerationProviderOptions(args, provider);

        if (system) settings.system = system;
        if (temperature !== undefined) settings.temperature = temperature;
        if (maxOutputTokens !== undefined) settings.maxOutputTokens = maxOutputTokens;
        if (providerOptions) settings.providerOptions = providerOptions;

        const outputSettings = getOutputSettings(args);
        if (outputSettings) settings.output = outputSettings;

        return settings;
    }

    function getTextGenerationProviderOptions(args: any, provider: string) {
        const reasoningEffort = normalizeOptionalString(args.providerOptions?.reasoningEffort);
        if (reasoningEffort) {
            // get reasoning effort provider options based on provider
            if (provider === 'openai') return { openai: { reasoningEffort } };
            if (provider === 'xai') return { xai: { reasoningEffort } };
            if (provider === 'mistral') return { mistral: { reasoningEffort } };
            if (provider === 'google-gemini') return { google: { thinkingConfig: { thinkingLevel: reasoningEffort } } };
            if (provider === 'anthropic')
                return { anthropic: { thinking: { type: 'adaptive' }, effort: reasoningEffort } };
            return undefined;
        }

        const reasoningBudgetTokens = normalizeOptionalNonNegativeInteger(args.providerOptions?.reasoningBudgetTokens);
        if (reasoningBudgetTokens !== undefined) {
            // get reasoning budget provider options based on provider
            if (provider === 'google-gemini')
                return { google: { thinkingConfig: { thinkingBudget: reasoningBudgetTokens } } };
            if (provider === 'anthropic')
                return { anthropic: { thinking: { type: 'enabled', budgetTokens: reasoningBudgetTokens } } };
            return undefined;
        }

        return undefined;
    }

    async function generateTextHandler(
        settings: {
            system?: string;
            temperature?: number;
            maxOutputTokens?: number;
            providerOptions?: any;
        },
        runtime: LanguageRuntime,
        messages: ModelMessage[]
    ) {
        const result = await generateText({
            ...settings,
            model: runtime.modelClient,
            messages,
        });

        return {
            output: result.output,
            text: result.text,
            usage: result.totalUsage,
            totalUsage: result.totalUsage,
            finishReason: result.finishReason,
        };
    }

    function isExposedStreamPart(part: TextStreamPart<any>) {
        return [
            'reasoning-delta',
            'source',
            'tool-call',
            'tool-input-start',
            'tool-input-delta',
            'tool-result',
            'raw',
        ].includes(part.type);
    }

    function createStreamChunk(chunk: string, part: TextStreamPart<any>, runLoop: boolean) {
        return {
            [STRUCTURED_STREAM_CHUNK_KEY]: true,
            chunk,
            part: normalizeStreamPart(part),
            runLoop,
        };
    }

    function normalizeStreamPart(part: TextStreamPart<any>) {
        try {
            return JSON.parse(JSON.stringify(part));
        } catch {
            return { type: part.type };
        }
    }

    async function streamTextHandler(
        settings: {
            system?: string;
            temperature?: number;
            maxOutputTokens?: number;
            providerOptions?: any;
        },
        runtime: LanguageRuntime,
        messages: ModelMessage[]
    ) {
        const result = streamText({
            ...settings,
            model: runtime.modelClient,
            messages,
        });

        async function* stream() {
            for await (const part of result.fullStream) {
                if (part.type === 'error') {
                    throw part.error;
                }
                if (part.type === 'text-delta') {
                    yield createStreamChunk(part.text, part, true);
                    continue;
                }
                yield createStreamChunk('', part, isExposedStreamPart(part));
            }
        }
        return stream();
    }

    return {
        name: 'generate-text',
        handler: async ({ args }: ActionParams, context: ActionContext, helpers: any) => {
            const runtime = await resolveRuntime({ args, context, helpers }, 'text', {
                proxyUrl: params.proxyUrl,
                env: params.env,
                wwProjectSecret: params.wwProjectSecret,
                wwProjectId: params.wwProjectId,
                getApiKey: params.getApiKey,
            });
            const settings = getTextGenerationSettings(args, runtime.provider);
            const messages = normalizeMessages(args);

            if (args.__wwstream === true) return streamTextHandler(settings, runtime, messages);
            return generateTextHandler(settings, runtime, messages);
        },
    };
}
