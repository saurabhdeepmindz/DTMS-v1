interface StyleSheetOptions {
    id: string;
    attributes?: Record<string, string>;
    preferCors?: boolean;
}

/** CORS exposes CSS rules for editor previews; unsupported providers retain ordinary loading. */
export function appendStyleSheet(
    document: Document,
    url: string,
    options: StyleSheetOptions
): Promise<HTMLLinkElement> {
    const attributes = options.attributes || {};
    const tryCors = options.preferCors && !Object.keys(attributes).some(name => name.toLowerCase() === 'crossorigin');
    function load(cors: boolean): Promise<HTMLLinkElement> {
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            if (cors) link.crossOrigin = 'anonymous';
            link.id = options.id;
            link.rel = 'stylesheet';
            link.href = url;
            for (const name in attributes) link.setAttribute(name, attributes[name]);
            const clearHandlers = () => {
                link.onload = null;
                link.onerror = null;
            };
            link.onload = () => {
                clearHandlers();
                resolve(link);
            };
            link.onerror = () => {
                clearHandlers();
                link.remove();
                if (cors) {
                    load(false).then(resolve, reject);
                    return;
                }
                reject(new Error('Unable to load stylesheet'));
            };
            document.head.appendChild(link);
        });
    }
    return load(!!tryCors);
}
