import { v4 as uuid, validate as isValidUUID } from 'uuid';
import { getValue } from '@/_common/helpers/code/customCode.js';
import { splitAuthoredLength } from '@/_common/helpers/css/authoredLength';

export default {
    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwUtils.getUid
     */
    getUniqueId() {
        wwLib.wwLog.warn('wwLib.wwUtils.getUniqueId is deprecated, use wwLib.wwUtils.getUid instead');
        var d = new Date();
        return Math.floor((d.getTime() * Math.random() + Math.random() * 10000 + Math.random() * 100) / 100);
    },

    /**
     * @PUBLIC_API
     */
    getUid() {
        return uuid();
    },

    /**
     * @PUBLIC_API
     */
    isValidUuid(string) {
        return isValidUUID(string);
    },

    /**
     * @PUBLIC_API
     */
    getCdnPrefix() {
        return import.meta.env.VITE_APP_CDN_URL;
    },

    /**
     * @PUBLIC_API
     */
    getLengthUnit(value, { defaultLength, defaultUnit, round = true } = {}) {
        return splitAuthoredLength(value, { defaultLength, defaultUnit, round });
    },

    /**
     * @PUBLIC_API
     */
    getStyleFromToken(token) {
        if (!token || typeof token !== 'string') return null;
        const VAR_REGEXP = /^var\(--(.+)\s*,\s*(.+)\)$/;
        let [, styleId] = token.match(VAR_REGEXP) || [];

        if (styleId) {
            styleId = styleId.split(',')[0];
 
            /* wwFront:start */
            // eslint-disable-next-line no-unreachable
            const themeColor = wwLib.globalContext?.colors?.[styleId];
            if (themeColor) return themeColor;
            const websiteWrapper = wwLib.getFrontDocument().getElementsByClassName('website-wrapper')[0];
            if (!websiteWrapper) return null;
            return getComputedStyle(websiteWrapper).getPropertyValue(`--${styleId}`) || null;
            /* wwFront:end */
        } else {
            return null;
        }
    },

    /**
     * @PUBLIC_API
     */
    getTypoFromToken(token) {
        if (!token) token = '400 12px/normal var(--ww-default-font-family, sans-serif)';
        let [fontStyle, fontWeight, sizes, ...familyParts] = token.split(' ');
        if (fontStyle !== 'italic') {
            [fontWeight, sizes, ...familyParts] = token.split(' ');
            fontStyle = null;
        }
        const [fontSize, lineHeight] = sizes.split('/');
        let fontFamily = familyParts && familyParts.length ? familyParts.join(' ') : undefined;
        if (fontFamily && fontFamily.startsWith('var(--')) {
            fontFamily = undefined;
        }
        fontWeight = parseInt(fontWeight || 400);
        if (isNaN(fontWeight)) {
            fontWeight = 400;
        }
        return {
            fontWeight,
            fontSize,
            lineHeight: lineHeight || 'normal',
            fontFamily,
            fontStyle,
        };
    },

    /**
     * @PUBLIC_API
     */
    getDataFromCollection(collection) {
        const isCollection = wwLib.wwCollection.isCollection(collection);
        if (!isCollection) {
            return collection;
        }
        // Non paginated collection
        if (!collection.limit || !collection.total) {
            return collection.data;
        }
        if (!Array.isArray(collection.data)) return collection.data;
        const offset = parseInt(collection.offset) || 0;
        return collection.data.slice(offset, offset + parseInt(getValue(collection.limit)));
    },

    /**
     * @PUBLIC_API
     */
    isEmpty(value) {
        return (
            value === undefined ||
            value === null ||
            value === '' ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === 'object' && JSON.stringify(value) === '{}')
        );
    },

    /**
     * @PUBLIC_API
     */
    resolveObjectPropertyPath(object, path) {
        return _.get(object, path);
    },

    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwApp.addScriptToHead
     */
    addScriptToHead(options, allowMultipleAdd = false) {
        wwLib.wwLog.warn('wwUtils.addScriptToHead is deprecated, use wwLib.wwApp.addScriptToHead instead');
        const attributes = {
            ...(options.async ? { async: options.async } : {}),
            ...(options.charset ? { defer: options.charset } : {}),
            ...(options?.attributes || {}),
        };
        wwLib.wwApp.addScriptToHead(options.link, attributes, { once: !allowMultipleAdd, editor: options.manager });
    },

 
    /**
     * @PUBLIC_API
     * @DEPRECATED wwLib.wwApp.scrollIntoView
     */
    scrollIntoView(element, offset = 0) {
        wwLib.wwLog.warn('wwUtils.scrollIntoView is deprecated, use wwLib.wwApp.scrollIntoView instead');
        wwLib.wwApp.scrollIntoView(element, { offset, behavior: 'smooth' });
    },

    convertColorToRGB(color) {
        const result = /^#?([a-fA-F\d]{2})([a-fA-F\d]{2})([a-fA-F\d]{2})([a-fA-F\d]{2})*$/i.exec(color);
        if (result) {
            const a = result[4] ? parseInt(result[4], 16) / 255 : 1;
            const rgba =
                'rgba(' +
                parseInt(result[1], 16) +
                ',' +
                parseInt(result[2], 16) +
                ',' +
                parseInt(result[3], 16) +
                ',' +
                a +
                ')';
            return rgba;
        } else {
            return color;
        }
    },

    convertImgExtToType(ext) {
        ext = ext || 'jpg';
        switch (ext) {
            case 'jpg':
                return 'image/jpeg';

            case 'svg':
                return 'image/svg+xml';

            default:
                return 'image/' + ext;
        }
    },

    formatBgImgUrl(imgUrl) {
        // Escape special chars https://stackoverflow.com/a/2168861
        return imgUrl.startsWith('url(') ? imgUrl : `url("${imgUrl.replace(/[()'"]/g, '\\$&')}")`;
    },

    getImgCdnUrl(url) {
        if (url.includes(import.meta.env.VITE_APP_CDN_URL)) {
            return url;
        }

        if (url.startsWith('https://') || url.startsWith('http://')) {
            return url;
        }

        return import.meta.env.VITE_APP_CDN_URL + url;
    },

    getImgExtFromUrl(url) {
        return url.split('.')[url.split('.').length - 1].toLowerCase().split('?')[0];
    },

    removeUid(obj) {
        if (obj && typeof obj === 'object') {
            if (obj.uid && obj.content) {
                obj.isWwObject = true;
                delete obj.uid;
            }

            for (const key in obj) {
                if (obj[key] && typeof obj[key] === 'object') {
                    wwLib.wwUtils.removeUid(obj[key]);
                }
            }
        }
    },

    sanitize(id) {
        if (!id || typeof id !== 'string') return '';
        return id.toLowerCase().replace(/\s/g, '_');
    },

    getComponentType(uid) {
        if (wwLib.store.websiteData.wwObjects[uid]?.wwObjectBaseId) {
            return 'element';
        } else if (wwLib.store.websiteData.wwObjects[uid]?.libraryComponentBaseId) {
            return 'libraryComponent';
        } else if (wwLib.store.websiteData.sections[uid]?.sectionBaseId) {
            return 'section';
        }
        return null;
    },
    formatBytes(bytes) {
        bytes = Number(bytes || 0);
        if (bytes === 0) return '0';
        const k = 1024;
        const sizes = ['b', 'Kb', 'Mb', 'Gb', 'Tb'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + '' + sizes[i];
    },
    formatDuration(ms) {
        ms = Number(ms || 0);
        if (ms === 0) return '0';
        if (ms < 1000) return ms.toFixed(0) + 'ms';
        if (ms < 60000) return Math.floor(ms / 1000).toFixed(0) + 's';
        if (ms < 3600000) return Math.floor(ms / 60000).toFixed(0) + 'm';
        if (ms < 86400000) return Math.floor(ms / 3600000).toFixed(0) + 'h';
        return Math.floor(ms / 86400000).toFixed(0) + 'd';
    },
    formatNumber(value) {
        value = Number(value || 0);
        return value.toLocaleString('en-US', {
            maximumFractionDigits: 2,
            // notation: 'compact',
            compactDisplay: 'short',
        });
    },
};
