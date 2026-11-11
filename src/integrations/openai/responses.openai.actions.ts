import OpenAI from 'openai';

global.registerAction('openai/responses-create', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.responses.create({
        background: args.background,
        conversation: args.conversation,
        include: args.include,
        input: args.input,
        instructions: args.instructions,
        max_output_tokens: args.max_output_tokens,
        metadata: args.metadata,
        model: args.model,
        parallel_tool_calls: args.parallel_tool_calls,
        previous_response_id: args.previous_response_id,
        prompt: args.prompt,
        prompt_cache_key: args.prompt_cache_key,
        prompt_cache_retention: args.prompt_cache_retention,
        reasoning: args.reasoning,
        safety_identifier: args.safety_identifier,
        service_tier: args.service_tier,
        store: args.store,
        stream: args.__wwstream,
        stream_options: args.stream_options,
        temperature: args.temperature,
        text: args.text,
        tool_choice: args.tool_choice,
        tools: args.tools,
        top_p: args.top_p,
        truncation: args.truncation,
    });
});

global.registerAction('openai/responses-retrieve', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.responses.retrieve(args.response_id, {
        include: args.include,
        include_obfuscation: args.include_obfuscation,
        starting_after: args.starting_after,
        stream: args.stream,
    });
});

global.registerAction('openai/responses-delete', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.responses.delete(args.response_id);
});

global.registerAction('openai/responses-cancel', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.responses.cancel(args.response_id);
});

global.registerAction('openai/responses-input-items-list', async ({ args }: ActionParams, context: ActionContext) => {
    const openai = new OpenAI({ apiKey: context.connection?.apiKey });

    return await openai.responses.inputItems.list(args.response_id, {
        after: args.after,
        include: args.include,
        limit: args.limit,
        order: args.order,
    });
});
