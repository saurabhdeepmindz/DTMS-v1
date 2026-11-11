export function denyStaticRenderNetwork(api: string): never {
    const error = new Error(`Network access is disabled during static rendering (${api})`);
    error.name = 'NotCapable';
    throw error;
}
