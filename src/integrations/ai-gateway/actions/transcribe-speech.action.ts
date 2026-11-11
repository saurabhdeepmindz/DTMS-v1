import { experimental_transcribe as transcribe } from 'ai';
import { resolveRuntime, type ResolveRuntimeParams } from '../utils/resolve-runtime.ts';
import { normalizeOptionalNumber, normalizeOptionalString } from '../utils/normalize.utils.ts';
import { dataURIToBuffer, dataURIToContentType, fileToBuffer, isDataURI } from '../../utils.ts';

export function buildTranscribeSpeechAction(params: ResolveRuntimeParams) {
    function parseDataUri(value: string) {
        const commaIndex = value.indexOf(',');
        if (commaIndex === -1) throw new Error('AI_TRANSCRIPTION_AUDIO_INVALID');
        const metadata = value.slice(0, commaIndex);
        const content = value.slice(commaIndex + 1);
        if (!metadata.includes(';base64')) return Buffer.from(decodeURIComponent(content));
        return Buffer.from(content, 'base64');
    }

    function normalizeAudioInput(value: unknown) {
        if (value instanceof URL) return value;
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);

        if (typeof value !== 'string') throw new Error('AI_TRANSCRIPTION_AUDIO_REQUIRED');

        const trimmedValue = value.trim();
        if (!trimmedValue) throw new Error('AI_TRANSCRIPTION_AUDIO_REQUIRED');
        if (/^https?:\/\//i.test(trimmedValue)) return new URL(trimmedValue);
        if (trimmedValue.startsWith('data:')) return parseDataUri(trimmedValue);

        return Buffer.from(trimmedValue, 'base64');
    }

    function getTranscriptionProviderOptions(args: any, provider: string, model: string) {
        const providerOptions: Record<string, any> = {};

        if (provider === 'openai') {
            const language = normalizeOptionalString(args.providerOptions?.language);
            const prompt = normalizeOptionalString(args.providerOptions?.prompt);
            const temperature = normalizeOptionalNumber(args.providerOptions?.temperature);

            const openaiOptions: Record<string, any> = {};
            if (language) openaiOptions.language = language;
            if (prompt) openaiOptions.prompt = prompt;
            if (temperature !== undefined) openaiOptions.temperature = temperature;
            if (model === 'whisper-1') openaiOptions.timestampGranularities = ['segment'];
            if (Object.keys(openaiOptions).length) providerOptions.openai = openaiOptions;
        }

        return Object.keys(providerOptions).length ? providerOptions : undefined;
    }

    const transformFileInput = async (input: unknown) => {
        if (input instanceof File) return await fileToBuffer(input);
        if (isDataURI(input)) return dataURIToBuffer(input as string);
        return input;
    };

    return {
        name: 'transcribe-speech',
        handler: async ({ args }: ActionParams, context: ActionContext, helpers: any) => {
            args.audio = await transformFileInput(args.audio);

            const runtime = await resolveRuntime({ args, context, helpers }, 'transcription', {
                proxyUrl: params.proxyUrl,
                env: params.env,
                wwProjectSecret: params.wwProjectSecret,
                wwProjectId: params.wwProjectId,
                getApiKey: params.getApiKey,
            });

            const result = await transcribe({
                model: runtime.modelClient,
                audio: normalizeAudioInput(args.audio),
                providerOptions: getTranscriptionProviderOptions(args, runtime.provider, runtime.model),
            });

            return {
                text: result.text,
                segments: result.segments,
                language: result.language ?? null,
            };
        },
    };
}
