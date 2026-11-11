import { experimental_generateSpeech as generateSpeech } from 'ai';
import { resolveRuntime, type ResolveRuntimeParams } from '../utils/resolve-runtime.ts';
import { normalizeOptionalNumber, normalizeOptionalString, normalizeRequiredString } from '../utils/normalize.utils.ts';
import { fileToResponse } from '../utils/file-to-response.ts';

export function buildGenerateSpeechAction(params: ResolveRuntimeParams) {
    return {
        name: 'generate-speech',
        handler: async ({ args }: ActionParams, context: ActionContext, helpers: any) => {
            const runtime = await resolveRuntime({ args, context, helpers }, 'speech', {
                proxyUrl: params.proxyUrl,
                env: params.env,
                wwProjectSecret: params.wwProjectSecret,
                wwProjectId: params.wwProjectId,
                getApiKey: params.getApiKey,
            });

            const settings = {
                voice: normalizeOptionalString(args.voice) || 'alloy',
                outputFormat: normalizeOptionalString(args.outputFormat) as any,
                speed: normalizeOptionalNumber(args.speed),
                instructions: normalizeOptionalString(args.instructions),
                language: normalizeOptionalString(args.language),
            };

            const result = await generateSpeech({
                ...settings,
                model: runtime.modelClient,
                text: normalizeRequiredString(args.text, 'AI_SPEECH_INPUT_REQUIRED'),
            });

            const audio = fileToResponse(result.audio);

            return {
                audio: {
                    ...audio,
                    format: result.audio.format,
                },
            };
        },
    };
}
