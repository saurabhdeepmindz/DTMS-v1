import { evaluateCode, createWwFormulas } from '../codeEval/utils.js';
import { FormulaError } from './errors.js';

function isFormulaBinding(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value;
  return (
    obj.__wwtype === 'f' || obj.__wwtype === 'js'
  ) && typeof obj.code === 'string';
}

function evaluateFormula(formula, context, integrations) {
  try {
    let codeToEvaluate;

    if (formula.__wwtype === 'f') {
      codeToEvaluate = `return ${formula.code};`;
    }
    else if (formula.__wwtype === 'js') {
      codeToEvaluate = formula.code;
    }
    else {
      throw new FormulaError(`Invalid formula type: ${formula.__wwtype}`, {
        formulaCode: formula.code,
        formulaType: formula.__wwtype,
      });
    }

    const wwFormulas = createWwFormulas(context);
    return evaluateCode({ code: codeToEvaluate, context, wwFormulas, integrations });
  }
  catch (error) {
    if (error instanceof FormulaError) {
      throw error;
    }

    throw new FormulaError(`Formula evaluation error: ${error.message}`, {
      originalError: error,
      formulaCode: formula.code,
      formulaType: formula.__wwtype,
    });
  }
}

export { evaluateFormula, isFormulaBinding }; 