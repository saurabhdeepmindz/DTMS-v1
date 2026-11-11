import OpenAI from 'openai';

global.registerAction('openai/images-generate', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    const result = await openai.images.generate({
        prompt: args.prompt,
        model: args.model,
        n: args.n,
        size: args.size,
        quality: args.quality,
        style: args.style,
        response_format: args.response_format,
        user: args.user,
        output_format: args.output_format,
        output_compression: args.output_compression,
        background: args.background,
    });

    if (result.data) {
        for (const image of result.data) {
            if (image.b64_json) {
                (image as any).uri_json = `data:image/${args.output_format ?? 'png'};base64,${image.b64_json}`;
            }
        }
    }
    return result;
});
