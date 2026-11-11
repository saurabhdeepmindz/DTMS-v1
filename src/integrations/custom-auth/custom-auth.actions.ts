global.registerAction('custom-auth/auth-set-user', async ({ args }: ActionParams, context: ActionContext) => {
    context.honoContext.set('user', args.user);

    return args.user;
});
