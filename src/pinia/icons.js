import { defineStore } from 'pinia';
 
export const useIconsStore = defineStore('icons', () => {
    let values = {};
 
    return {
        async getIcon(name) {
             /* wwFront:start */
            if (values[name]) {
                return await values[name];
            }

            const baseTag = window.wwg_designInfo?.baseTag;
            let href = baseTag?.href || null;
            if (href) {
                if (!href.startsWith('/')) href = `/${href}`;
                if (!href.endsWith('/')) href = `${href}/`;
            }
            const url = `${href ?? '/'}icons/${name}.svg`;
            values[name] = fetch(url).then(response => {
                if (!response.ok) {
                    return null;
                }
                return response.text();
            });
            return await values[name];
            /* wwFront:end */
        },
     };
});
