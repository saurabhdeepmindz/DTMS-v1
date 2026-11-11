export default {
    execute: async (c, hook, event) => {
        const [hookType, key] = String(hook || '').split('/');
        if (!hookType) return;

        const registry = global.hooks?.[hookType];
        if (!registry) return;

        if (key) {
            const handlers = registry?.[key] || [];
            await Promise.all(handlers.map(handler => handler(c, event)));
            return;
        }

        const handlers = Object.values(registry).flat();
        await Promise.all(handlers.map(handler => handler(c, event)));
    },
};