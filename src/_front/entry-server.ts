import { renderToString } from 'vue/server-renderer';
import {
    completeClientIslandServerRender,
    prepareClientIslandServerRender,
    type ClientIslandRenderResult,
} from './rendering/clientIslandContext';
import {
    createInitialEnvironment,
    installInitialEnvironment,
    type InitialEnvironment,
} from './rendering/initialEnvironment';
import {
    cancelStyleCompilerPrerenderRuntime,
    completeStyleCompilerPrerenderRuntime,
    prepareStyleCompilerPrerenderRuntime,
} from './rendering/styleCompilerPrerenderRuntime';

export async function render(
    url: string,
    clientIslandIds: string[] = []
): Promise<{
    appHtml: string;
    clientIslands: ClientIslandRenderResult;
    initialEnvironment: InitialEnvironment;
    runtimeCss: string;
}> {
    const initialEnvironment = createInitialEnvironment();
    const restoreEnvironment = installInitialEnvironment(initialEnvironment);
    prepareClientIslandServerRender(clientIslandIds);
    try {
        const { app, setupApp } = await import('./main.js');
        await setupApp({ url });
        prepareStyleCompilerPrerenderRuntime();
        const appHtml = await renderToString(app);
        const runtimeCss = completeStyleCompilerPrerenderRuntime();
        return {
            appHtml,
            clientIslands: completeClientIslandServerRender(),
            initialEnvironment,
            runtimeCss,
        };
    } finally {
        cancelStyleCompilerPrerenderRuntime();
        restoreEnvironment();
    }
}
