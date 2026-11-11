import { cloneDeep, set } from 'lodash-es';

export function checkVariableType(variable, value, { path, arrayUpdateType } = {}) {
    switch (variable.type) {
        case 'boolean':
            if (value === 'true') value = true;
            if (value === 'false') value = false;
            if (typeof value !== 'boolean') throw new Error('value must be a boolean');
            break;
        case 'query':
        case 'string':
            if (value !== null && typeof value === 'object')
                throw new Error('value must be a string, a number or a boolean');
            if (value !== null) value = `${value}`;
            break;
        case 'number':
            if (typeof value === 'string') {
                try {
                    value = parseFloat(value);
                    if (isNaN(value)) value = null;
                } catch (error) {
                    value = null;
                }
            }
            if (value !== null && typeof value !== 'number') throw new Error('value must be a number');
            break;
        case 'array':
            if (value !== null && !Array.isArray(value) && !arrayUpdateType) throw new Error('value must be an array');
            break;
        case 'object':
            if (value !== null && typeof value !== 'object' && !path) throw new Error('value must be an object');
            break;
    }

    return value;
}

export function applyVariableUpdate(variable, currentValue, value, { path, index, arrayUpdateType } = {}) {
    if (value === undefined && !['delete', 'shift', 'pop'].includes(arrayUpdateType)) {
        return currentValue;
    }

    value = checkVariableType(variable, value, { path, arrayUpdateType });

    if (variable.type === 'object' && path) {
        const nextValue =
            currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) ? cloneDeep(currentValue) : {};
        set(nextValue, path, value);
        return nextValue;
    }

    if (variable.type === 'array' && arrayUpdateType) {
        const nextValue = Array.isArray(currentValue) ? cloneDeep(currentValue) : [];
        const nextIndex = index || 0;

        switch (arrayUpdateType) {
            case 'update': {
                const finalPath = path ? `[${nextIndex}].${path}` : `[${nextIndex}]`;
                set(nextValue, finalPath, value);
                break;
            }
            case 'delete':
                nextValue.splice(nextIndex, 1);
                break;
            case 'insert':
                nextValue.splice(nextIndex, 0, value);
                break;
            case 'unshift':
                nextValue.unshift(value);
                break;
            case 'push':
                nextValue.push(value);
                break;
            case 'shift':
                nextValue.shift();
                break;
            case 'pop':
                nextValue.pop();
                break;
        }

        return nextValue;
    }

    return value;
}
