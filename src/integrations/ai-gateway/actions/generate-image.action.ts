import { generateImage } from 'ai';
import { resolveRuntime, type ResolveRuntimeParams } from '../utils/resolve-runtime.ts';
import {
    normalizeOptionalBoundedInteger,
    normalizeOptionalNumber,
    normalizeOptionalString,
    normalizeRequiredString,
} from '../utils/normalize.utils.ts';
import { fileToResponse } from '../utils/file-to-response.ts';

export function buildGenerateImageAction(params: ResolveRuntimeParams) {
    function getImageProviderOptions(args: any, provider: string) {
        const providerOptions: Record<string, any> = {};

        if (provider === 'openai') {
            const quality = normalizeOptionalString(args.providerOptions?.quality);
            const outputFormat = normalizeOptionalString(args.providerOptions?.outputFormat);

            const openaiOptions: Record<string, any> = {};
            if (quality && quality !== 'auto') openaiOptions.quality = quality;
            if (outputFormat) openaiOptions.outputFormat = outputFormat;
            if (Object.keys(openaiOptions).length) providerOptions.openai = openaiOptions;
        }

        if (provider === 'xai') {
            const quality = normalizeOptionalString(args.providerOptions?.quality);
            const outputFormat = normalizeOptionalString(args.providerOptions?.outputFormat);
            const resolution = normalizeOptionalString(args.providerOptions?.resolution);

            const xaiOptions: Record<string, any> = {};
            if (quality && quality !== 'auto') xaiOptions.quality = quality;
            if (outputFormat) xaiOptions.output_format = outputFormat;
            if (resolution) xaiOptions.resolution = resolution;
            if (Object.keys(xaiOptions).length) providerOptions.xai = xaiOptions;
        }

        return Object.keys(providerOptions).length ? providerOptions : undefined;
    }

    function getImageGenerationSettings(args: any, provider: string) {
        const settings: Record<string, any> = {};
        const n = normalizeOptionalBoundedInteger(args.n, 1, 10);
        const size = normalizeOptionalString(args.size);
        const aspectRatio = normalizeOptionalString(args.aspectRatio);
        const seed = normalizeOptionalNumber(args.seed);
        const providerOptions = getImageProviderOptions(args, provider);

        if (n !== undefined) settings.n = n;
        if (size && size !== 'auto') settings.size = size;
        if (seed !== undefined) settings.seed = seed;
        if (aspectRatio) settings.aspectRatio = aspectRatio;
        if (providerOptions) settings.providerOptions = providerOptions;

        return settings;
    }

    return {
        name: 'generate-image',
        handler: async ({ args }: ActionParams, context: ActionContext, helpers: any) => {
            const runtime = await resolveRuntime({ args, context, helpers }, 'image', {
                proxyUrl: params.proxyUrl,
                env: params.env,
                wwProjectSecret: params.wwProjectSecret,
                wwProjectId: params.wwProjectId,
                getApiKey: params.getApiKey,
            });
            const settings = getImageGenerationSettings(args, runtime.provider);

            const result = await generateImage({
                ...settings,
                model: runtime.modelClient,
                prompt: normalizeRequiredString(args.prompt, 'AI_IMAGE_PROMPT_REQUIRED'),
            });

            const images = result.images.map(fileToResponse);
            return {
                images,
                usage: result.usage,
            };
        },
    };
}
