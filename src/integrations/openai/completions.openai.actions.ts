import OpenAI from 'openai';

global.registerAction('openai/chat-completions-create', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.chat.completions.create({
        messages: args.messages,
        model: args.model,
        audio: args.audio,
        frequency_penalty: args.frequency_penalty,
        logit_bias: args.logit_bias,
        logprobs: args.logprobs,
        max_completion_tokens: args.max_completion_tokens,
        metadata: args.metadata,
        modalities: args.modalities,
        n: args.n,
        parallel_tool_calls: args.parallel_tool_calls,
        prediction: args.prediction,
        presence_penalty: args.presence_penalty,
        prompt_cache_key: args.prompt_cache_key,
        prompt_cache_retention: args.prompt_cache_retention,
        reasoning_effort: args.reasoning_effort,
        response_format: args.response_format,
        safety_identifier: args.safety_identifier,
        service_tier: args.service_tier,
        stop: args.stop,
        store: args.store,
        stream: args.stream,
        stream_options: args.stream_options,
        temperature: args.temperature,
        tool_choice: args.tool_choice,
        tools: args.tools,
        top_logprobs: args.top_logprobs,
        top_p: args.top_p,
        verbosity: args.verbosity,
        web_search_options: args.web_search_options,
    });
});

global.registerAction('openai/chat-completions-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.chat.completions.retrieve(args.completion_id);
});

global.registerAction(
    'openai/chat-completions-messages-list',
    async ({ args }: ActionParams, context: ActionContext) => {
        const openai = new OpenAI({ apiKey: context.connection?.apiKey });

        return await openai.chat.completions.messages.list(args.completion_id, {
            after: args.after,
            limit: args.limit,
            order: args.order,
        });
    }
);

global.registerAction('openai/chat-completions-list', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.chat.completions.list({
        after: args.after,
        limit: args.limit,
        metadata: args.metadata,
        model: args.model,
        order: args.order,
    });
});

global.registerAction('openai/chat-completions-update', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.chat.completions.update(args.completion_id, {
        metadata: args.metadata,
    });
});

global.registerAction('openai/chat-completions-delete', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.chat.completions.delete(args.completion_id);
});
