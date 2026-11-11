import { dateFormulas } from './dateFormulas.js';
import { getStorageUrl as resolveStorageUrl } from '../../storagePublicUrl.service.js';
import { isPlainObject } from '../../../utils/objectGuards.ts';

function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
}

function getDataFromCollection(data) {
    // In backend, we don't have collections, just return the data as-is
    return data;
}

// Deep equality check (replaces lodash isEqual)
function isEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((val, idx) => isEqual(val, b[idx]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every(key => isEqual(a[key], b[key]));
    }

    return false;
}

// Get nested property (replaces lodash get)
function get(obj, path, defaultValue) {
    if (!obj || !path) return defaultValue;
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
        result = result?.[key];
        if (result === undefined) return defaultValue;
    }
    return result;
}

// RFC 5322 compliant email regex
const EMAIL_REGEX =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

// Static formulas that don't need runtime context (created once)
export const staticWwFormulas = {
    if(cond, iftrue, iffalse) {
        return cond ? iftrue : iffalse;
    },
    ifEmpty(cond, val, valIfNotEmpty) {
        if (isEmpty(cond)) {
            return val;
        } else {
            return valIfNotEmpty === undefined ? cond : valIfNotEmpty;
        }
    },
    not(val) {
        return !val;
    },
    compare(val1, val2) {
        return isEqual(val1, val2);
    },
    switch(cond, value, result, ...args) {
        const values = [value, result, ...args].filter((_, i) => i % 2 === 0);
        const results = [value, result, ...args].filter((_, i) => i % 2 === 1);
        const index = values.findIndex(val => val === cond);
        if (index === -1) {
            return values.length > results.length ? values[results.length] : undefined;
        } else {
            return results[index];
        }
    },
    average(arr, ...args) {
        if (!Array.isArray(arr)) {
            arr = [arr, ...args];
        }
        if (arr.length === 0) return 0;
        return arr.reduce((sum, val) => sum + val, 0) / arr.length;
    },
    sum(arr, ...args) {
        if (!Array.isArray(arr)) {
            arr = [arr, ...args];
        }
        return arr.reduce((sum, val) => sum + val, 0);
    },
    round(value, precision = 0) {
        const multiplier = Math.pow(10, precision);
        return Math.round(value * multiplier) / multiplier;
    },
    length(arr) {
        if (typeof arr === 'string') return arr.length;
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection) or a string';
        return arr.length;
    },
    keys(obj) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        return Object.keys(obj);
    },
    values(obj) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        return Object.values(obj);
    },
    objectToArray(obj) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        return Object.entries(obj);
    },
    slice(arr, start, end) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return arr.slice(start, end);
    },
    merge(...args) {
        const _args = args.map(arg => {
            const _arg = getDataFromCollection(arg);
            if (!Array.isArray(_arg)) throw 'All parameters must be arrays (or collections)';
            return _arg;
        });
        return [].concat(..._args);
    },
    contains(arr, value) {
        if (!arr && arr !== '') return false;
        if (typeof arr === 'string') {
            return arr.includes(value);
        }
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection) or a string';
        return arr.includes(value);
    },
    map(arr, key, ...keys) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        if (keys.length === 0) {
            return arr.map(val => val && get(val, key));
        } else {
            keys = [key, ...keys];
            return arr.map(val => {
                if (!val) return {};
                else {
                    const obj = {};
                    for (let k of keys) {
                        obj[k] = val[k];
                    }
                    return obj;
                }
            });
        }
    },
    reverse(arr) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return [...arr].reverse();
    },
    distinct(arr) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return arr.reduce((result, value) => {
            if (!result.some(resultValue => isEqual(value, resultValue))) result.push(value);
            return result;
        }, []);
    },
    groupBy(arr, key) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        const result = {};
        for (let value of arr) {
            const _value = get(value, key);
            if (value) {
                if (!result[_value]) {
                    result[_value] = [value];
                } else {
                    result[_value].push(value);
                }
            }
        }
        return result;
    },
    rollupSum(arr, key) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';

        return arr.reduce(
            (total, value) => (value && get(value, key) ? total + parseFloat(get(value, key)) : total),
            0
        );
    },
    sort(arr, order = 'asc', key) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        const moveUp = order === 'asc' ? 1 : -1;
        const moveDown = order === 'asc' ? -1 : 1;
        if (!key) {
            return [...arr].sort((a, b) => ((a || '') > (b || '') ? moveUp : moveDown));
        } else {
            return [...arr].sort((a, b) =>
                ((a && get(a, key)) || '') > ((b && get(b, key)) || '') ? moveUp : moveDown
            );
        }
    },
    flat(arr) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return arr.flat();
    },
    concatenate(...args) {
        return `${args.join('')}`;
    },
    split(str, separator) {
        if (!str || typeof str !== 'string') throw 'First parameter must be a text';
        return str.split(separator);
    },
    lowercase(str) {
        if (!str || typeof str !== 'string') throw 'First parameter must be a text';
        return str.toLowerCase();
    },
    capitalize(s) {
        if (!s || typeof s !== 'string') throw 'First parameter must be a text';

        let str = '';
        for (let i = 0; i < s.length; i++) {
            let prevChar = i === 0 ? ' ' : s[i - 1];
            if (
                prevChar === ' ' ||
                (prevChar.match(/[\u0020-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/) &&
                    prevChar !== "'" &&
                    prevChar !== '_')
            ) {
                str += s[i] !== '_' ? s[i].toUpperCase() : s[i];
            } else if (
                (prevChar === "'" &&
                    (i <= 1 || s[i - 2].match(/[\u0020-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/))) ||
                prevChar.match(/[\u00A0-\u00BF\u02B0-\u036F\u2000-\u206F\u20A0-\u20CF\u2100-\u218F]/)
            ) {
                str += s[i] !== '_' ? s[i].toUpperCase() : s[i];
            } else {
                str += s[i];
            }
        }
        return str;
    },
    uppercase(str) {
        if (!str || typeof str !== 'string') throw 'First parameter must be a text';
        return str.toUpperCase();
    },
    indexOf(str, val, start = 0) {
        if (!str || typeof str !== 'string') throw 'First parameter must be a text';
        return str.indexOf(val, start);
    },
    add(arr, ...args) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return [...arr, ...args];
    },
    prepend(arr, ...args) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return [...args, ...arr];
    },
    remove(arr, value) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return arr.filter(val => !isEqual(val, value));
    },
    filterByKey(arr, key, value) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        if (value === undefined) {
            return arr.filter(i => get(i, key));
        }
        if (Array.isArray(value)) {
            return arr.filter(i => value.includes(get(i, key)));
        }
        return arr.filter(i => get(i, key) === value);
    },
    removeByKey(arr, key, value) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        if (value === undefined) {
            return arr.filter(i => !get(i, key));
        }
        if (Array.isArray(value)) {
            return arr.filter(i => !value.includes(get(i, key)));
        }
        return arr.filter(i => get(i, key) !== value);
    },
    removeByIndex(arr, index) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        const _index = parseInt(index);
        if (isNaN(_index)) throw 'Second parameter must be a number';
        if (_index < 0 || _index >= arr.length) return arr;
        const result = [...arr];
        result.splice(_index, 1);
        return result;
    },
    getKeyValue(obj, key) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        return get(obj, key);
    },
    setKeyValue(obj, key, value) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        return { ...obj, [key]: value };
    },
    toText(value) {
        return `${value}`;
    },
    trim(value) {
        return `${value}`.trim();
    },
    trimStart(value) {
        return `${value}`.trimStart();
    },
    trimEnd(value) {
        return `${value}`.trimEnd();
    },
    toNumber(value) {
        return parseFloat(value);
    },
    createObject(...args) {
        const keys = [...args].filter((_, i) => i % 2 === 0);
        const values = [...args].filter((_, i) => i % 2 === 1);
        const result = {};
        keys.forEach((key, i) => {
            if (!key || Array.isArray(key) || typeof key === 'object') {
                throw `${key} is an invalid key`;
            }
            result[`${key}`] = values[i];
        });

        return result;
    },
    createArray(...args) {
        return [...args];
    },
    pick(obj, ...args) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        const keys = [...args];
        return keys.reduce((result, key) => {
            result[key] = get(obj, key);
            return result;
        }, {});
    },
    omit(obj, ...args) {
        if (!isPlainObject(obj)) throw 'First parameter must be an object';
        const keys = Object.keys(obj).filter(key => !args.includes(key));
        return keys.reduce((result, key) => {
            result[key] = get(obj, key);
            return result;
        }, {});
    },
    join(arr, separator = ',') {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        if (typeof separator !== 'string') throw 'Second parameter must be a text';
        return arr.join(separator);
    },
    getByIndex(arr, index) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        const _index = parseInt(index);
        if (isNaN(_index)) throw 'Second parameter must be a number';
        return arr[_index];
    },
    toBool(value) {
        return Boolean(value);
    },
    lookup(value, arr, key = 'id') {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'Second parameter must be an array (or collection)';
        return arr.filter(item => get(item, key) === value).shift();
    },
    lookupArray(arrValues, arr, key = 'id') {
        arr = getDataFromCollection(arr);
        arrValues = getDataFromCollection(arrValues);
        if (!Array.isArray(arrValues)) throw 'First parameter must be an array (or collection)';
        if (!Array.isArray(arr)) throw 'Second parameter must be an array (or collection)';
        return arr.filter(item => arrValues.includes(get(item, key)));
    },
    rollup(arr, key, distinct) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';

        const values = arr.reduce((result, value) => {
            const _value = get(value, key);
            if (_value === undefined || _value === null) return result;
            return result.concat(_value);
        }, []);

        return distinct ? this.distinct(values) : values;
    },
    findIndex(arr, value) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        return arr.findIndex(v => isEqual(v, value));
    },
    findIndexByKey(arr, key, value) {
        arr = getDataFromCollection(arr);
        if (!Array.isArray(arr)) throw 'First parameter must be an array (or collection)';
        if (typeof key !== 'string') throw 'Second parameter must be a text';
        return arr.findIndex(v => isEqual(get(v, key), value));
    },
    textLength(text) {
        if (typeof text !== 'string') throw 'First parameter must be a text';
        return text.length;
    },
    subText(text, start, end) {
        if (typeof text !== 'string') throw 'First parameter must be a text';
        start = parseInt(start);
        if (isNaN(start)) throw 'Second parameter must be a number';
        if (end !== undefined) {
            end = parseInt(end);
            if (isNaN(end)) throw 'Third parameter must be a number';
        }
        return text.substring(start, end);
    },
    isEmail(email) {
        if (!email || typeof email !== 'string') return false;
        return EMAIL_REGEX.test(email);
    },
    ...dateFormulas,
};

// Dynamic formulas that need runtime context (created per request)
export const createDynamicWwFormulas = context => ({
    getStorageUrl(key, access = 'public') {
        return resolveStorageUrl(key, access, context?.runtimeEnv || 'current');
    },
    matchAnyRoles(...roles) {
        if (!context?.auth?.user?.roles) return false;
        return roles.some(role => context.auth.user.roles.includes(role));
    },
    matchAllRoles(...roles) {
        if (!context?.auth?.user?.roles) return false;
        return roles.every(role => context.auth.user.roles.includes(role));
    },
});
