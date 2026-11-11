import type { ModelMessage } from 'ai';

export function normalizeMessages(args: {
    messages?: {
        role: string;
        content: string;
    }[];
    prompt?:
        | {
              role: string;
              content: string;
          }[]
        | string;
}): ModelMessage[] {
    if (Array.isArray(args.messages)) {
        return args.messages.map(
            message =>
                ({
                    role: message.role,
                    content: message.content,
                }) as ModelMessage
        );
    }
    if (Array.isArray(args.prompt)) {
        return args.prompt.map(
            message =>
                ({
                    role: message.role,
                    content: message.content,
                }) as ModelMessage
        );
    }
    return [{ role: 'user', content: args.prompt || '' }];
}

export function normalizeRequiredString(value: unknown, errorCode: string) {
    const normalizedValue = normalizeOptionalString(value);
    if (normalizedValue) return normalizedValue;
    throw new Error(errorCode);
}

export function normalizeRequiredModel(value: unknown) {
    return normalizeRequiredString(value, 'AI_MODEL_REQUIRED');
}

export const OPERATION_PROVIDERS: Record<string, string[]> = {
    text: ['openai', 'anthropic', 'google-gemini', 'mistral', 'xai', 'deepseek'],
    embedding: ['openai', 'google-gemini'],
    image: ['openai', 'google-gemini', 'xai'],
    speech: ['openai'],
    transcription: ['openai'],
};
export function normalizeRequiredProvider(value: unknown, operation: string) {
    const provider = normalizeRequiredString(value, 'AI_PROVIDER_REQUIRED');
    if (!OPERATION_PROVIDERS[operation]?.includes(provider)) throw new Error('AI_PROVIDER_UNSUPPORTED');
    return provider;
}

export function normalizeOptionalString(value: unknown) {
    if (typeof value !== 'string') return undefined;
    const trimmedValue = value.trim();
    return trimmedValue || undefined;
}

export function normalizeOptionalNumber(value: unknown) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string') return undefined;
    const trimmedValue = value.trim();
    if (!trimmedValue) return undefined;
    const parsedValue = Number(trimmedValue);
    return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export function normalizeOptionalPositiveInteger(value: unknown) {
    const normalizedValue = normalizeOptionalNumber(value);
    if (normalizedValue === undefined || normalizedValue <= 0) return undefined;
    return Math.floor(normalizedValue);
}

export function normalizeOptionalNonNegativeInteger(value: unknown) {
    const normalizedValue = normalizeOptionalNumber(value);
    if (normalizedValue === undefined || normalizedValue < 0) return undefined;
    return Math.floor(normalizedValue);
}

export function normalizeOptionalBoundedInteger(value: unknown, min: number, max: number) {
    const normalizedValue = normalizeOptionalNumber(value);
    if (normalizedValue === undefined) return undefined;
    return Math.max(min, Math.min(max, Math.floor(normalizedValue)));
}
