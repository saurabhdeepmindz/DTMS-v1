import OpenAI from 'openai';

global.registerAction('openai/audio-speech-create', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    const response = await openai.audio.speech.create({
        model: args.model,
        input: args.input,
        voice: args.voice,
        response_format: args.response_format,
        speed: args.speed,
    });

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString('base64')}`;
});
