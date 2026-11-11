/* eslint-disable no-new-func */

function compile(code, asynchronous) {
    // Keep console in the outer scope: user code may declare its own console or use strict mode.
    const factory = new Function(
        'console',
        `return ${asynchronous ? 'async ' : ''}function(context, wwFormulas, integrations) {\n${code}\n};`
    );

    return (context, wwFormulas, integrations, output = globalThis.console) =>
        factory(output)(context, wwFormulas, integrations);
}

function compileCode(code) {
    return compile(code, false);
}

function compileCodeAsync(code) {
    return compile(code, true);
}

export { compileCode, compileCodeAsync };
