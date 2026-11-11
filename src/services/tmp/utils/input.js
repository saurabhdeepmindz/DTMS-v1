import { createCodeContext } from '../codeEval/utils.js';
import { evaluateFormula, isFormulaBinding } from '../formulas/utils.js';
import { buildIntegrationBindings } from '../../integrationInstances.service.ts';

export function getValue(mappingObj, context) {
    if (mappingObj === null || mappingObj === undefined) {
        return mappingObj;
    }

    if (typeof mappingObj === 'object' && isFormulaBinding(mappingObj)) {
        const formulaContext = createCodeContext(context);
        return evaluateFormula(mappingObj, formulaContext, buildIntegrationBindings(context));
    }

    if (Array.isArray(mappingObj)) {
        return mappingObj.map(item => getValue(item, context));
    }

    if (typeof mappingObj === 'object' && mappingObj !== null) {
        // Only process plain objects, not Date, Map, etc.
        if (Object.getPrototypeOf(mappingObj) !== Object.prototype) {
            return mappingObj;
        }

        const result = {};
        for (const [key, value] of Object.entries(mappingObj)) {
            result[key] = getValue(value, context);
        }
        return result;
    }

    return mappingObj;
}

// Gets a value from a nested object using dot notation (e.g., "user.address.city")
export function getNestedValue(obj, path) {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
        if (current === null || current === undefined) {
            return undefined;
        }

        if (typeof current !== 'object') {
            return undefined;
        }

        current = current[key];
    }

    return current;
}
