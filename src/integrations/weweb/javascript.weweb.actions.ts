import { evaluateCodeAsync, createCodeContext, createWwFormulas } from '../../services/tmp/codeEval/utils.js';
import { buildIntegrationBindings } from '../../services/integrationInstances.service.ts';

type CustomJSActionParams = { code: string } & ActionParams;

global.registerAction('custom-js', async (action: CustomJSActionParams, context: ActionContext) => {
    const codeContext = createCodeContext(context);
    const wwFormulas = createWwFormulas(context);
    const integrations = buildIntegrationBindings(context);

    return await evaluateCodeAsync({ code: action.code, context: codeContext, wwFormulas, integrations });
});
