export default {
    defaultLang: 'en',
    init(router) {
        if (!wwLib.wwWebsiteData.getInfo()) return;
        this.defaultLang = wwLib.wwWebsiteData.getInfo().langs.find(lang => lang.default)?.lang || 'en';

        const base = wwLib.useBaseTag() ? wwLib.getBaseTag() : '/';

        wwLib.store.front.setLang(router.resolve(window.location.pathname.replace(base, '/'))?.meta?.lang?.lang);
    },
    /**
     * @PUBLIC_API
     */
    get lang() {
        return wwLib.$pinia ? wwLib.store.front.lang : this.defaultLang;
    },

    /**
     * @PUBLIC_API
     */
    set lang(lang) {
        this.setLang(lang);
    },

    /**
     * @PUBLIC_API
     */
    setLang(lang) {
        const pageLangs = wwLib.store.websiteData.page.langs || [];
        if (!pageLangs.includes(lang)) {
            return false;
        }

        var oldLang = this.lang;

        wwLib.store.front.setLang(lang);

        // eslint-disable-next-line vue/custom-event-name-casing
        wwLib.$emit('wwLang:changed', {
            old: oldLang,
            new: this.lang,
        });

        return true;
    },

    /**
     * @PUBLIC_API
     */
    getText(text) {
        if (text === undefined) {
            return '';
        }
        if (text === null || typeof text !== 'object') {
            return String(text);
        }
        if (text[this.lang] !== undefined) {
            return text[this.lang];
        }
        if (text[this.defaultLang] !== undefined) {
            return text[this.defaultLang];
        }
        if (Object.keys(text).length != 0) {
            return text[Object.keys(text)[0]] || '';
        }

        return '';
    },

    /**
     * @PUBLIC_API
     */
    setText(obj, text, lang) {
        if (typeof obj !== 'object') {
            obj = {};
        }

        lang = lang || this.lang;

        obj[lang] = text;

        return obj;
    },
};
