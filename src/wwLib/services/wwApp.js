import { appendStyleSheet } from '@/_common/helpers/styleSheetLoader';

export default {
    /**
     * @PUBLIC_API
     */
    scrollIntoView(element, options = {}) {
        options = { left: 0, offset: 0, behavior: 'smooth', ...options };
        const rect = element.getBoundingClientRect();

        wwLib
            .getFrontDocument()
            .querySelector('html')
            .scrollTo({
                top: rect.top + wwLib.getFrontWindow().scrollY - options.offset,
                behavior: options.behavior,
            });
    },

    /**
     * @PUBLIC_API
     */
    addScriptToHead(scriptUrl, attributes = {}, options = {}) {
        options = { once: true, editor: false, ...options };
        if (!scriptUrl) {
            return;
        }
        return new Promise(function (resolve, reject) {
            try {
                const scriptAlreadyInDom = wwLib.getFrontDocument().head.querySelector(`script[src="${scriptUrl}"]`);

                // Get or create unique script id
                let uniqueId;
                if (scriptAlreadyInDom && options.once) {
                    uniqueId = scriptAlreadyInDom.getAttribute('id');
                    return resolve();
                } else {
                    uniqueId = wwLib.wwUtils.getUid();

                    let styleToAdd = createScript(wwLib.getFrontDocument(), {
                        id: uniqueId,
                        type: 'text/javascript',
                        src: scriptUrl,
                        ...attributes,
                    });

                    styleToAdd.onload = function () {
                        wwLib.$emit('wwUtils:newStyle-' + uniqueId);
                        return resolve();
                    };
                    styleToAdd.onerror = function () {
                        return reject();
                    };
                    wwLib.getFrontDocument().head.appendChild(styleToAdd);

                 }
            } catch (e) {
                return reject(e);
            }
        });
    },

    /**
     * @PUBLIC_API
     */
    addStyleSheetToHead(styleUrl, attributes = {}, options = {}) {
        if (!styleUrl) return;
        try {
            const document = wwLib.getFrontDocument();
            const existing = [...document.querySelectorAll('link[href]')].some(
                link => link.getAttribute('href') === styleUrl
            );
            if (existing) return Promise.resolve();

            const id = wwLib.wwUtils.getUid();
            const loadOptions = { id, attributes, preferCors: false };
             const loaded = appendStyleSheet(document, styleUrl, loadOptions);

 
            return loaded.then(() => {
                wwLib.$emit('wwUtils:newStyle-' + id);
            });
        } catch (error) {
            return Promise.reject(error);
        }
    },

    /**
     * @PUBLIC_API
     */
    goTo(route, query = {}, options = {}) {
 
        /* wwFront:start */
        //Add leading '/'
        if (route && typeof route === 'string' && !route.startsWith('/')) {
            route = `/${route}`;
        }

        //Add trailling '/'
        if (route && typeof route === 'string' && !route.endsWith('/')) {
            route = `${route}/`;
        }

        route = wwLib.getFrontRouter().resolve({ path: route, query, hash: options.hash });
        if (options && options.openInNewTab) window.open(route.href, '_blank').focus();
        //Prevent page change if same page
        else if (route.href === wwLib.getFrontRouter().currentRoute.value.href && !options.hash) return;
        else {
            wwLib.getFrontRouter().push(route);
            if (route.name === wwLib.getFrontRouter().currentRoute.value.name && options.hash) {
                const section = wwLib.getFrontDocument().getElementById(options.hash.replace('#', ''));
                section
                    ? wwLib.wwApp.scrollIntoView(section)
                    : wwLib.getFrontWindow().scroll({
                          top: 0,
                          left: 0,
                          behavior: 'smooth',
                      });
            }
        }
        /* wwFront:end */
    },
};

function createScript(document, attributes = {}) {
    const scriptEl = document.createElement('script');
    Object.keys(attributes).forEach(attr => scriptEl.setAttribute(attr, attributes[attr]));
    return scriptEl;
}
