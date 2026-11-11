import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import autoprefixer from 'autoprefixer';
import wewebCssLayerPlugin from './weweb-postcss-layer-plugin.cjs';
import path from 'path';
import fs from 'fs';
import { parseEnv } from 'node:util';
import handlebars from 'handlebars';
import { createSsrPageComponentLoadersPlugin } from './vitePlugins/ssrPageComponentLoaders.ts';

const pages = {"47eea8fb-3bd0-4f2a-89fb-d1ee508eebf1-en":{"outputDir":"./404","lang":"en","title":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI","cacheVersion":"3","meta":[{"name":"title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"itemprop":"name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"name":"twitter:card","content":"summary"},{"name":"twitter:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:site_name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:type","content":"website"},{"name":"robots","content":"index, follow"}],"scripts":{"head":"\n","body":"\n"},"baseTag":{"href":"/","target":"_self"},"alternateLinks":[{"rel":"alternate","hreflang":"x-default","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/404/"},{"rel":"alternate","hreflang":"en","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/404/"}]},"e5cea5a2-8fd0-484c-b480-87cda4252e95-en":{"outputDir":"./","lang":"en","title":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI","cacheVersion":"3","meta":[{"name":"title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"itemprop":"name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"name":"twitter:card","content":"summary"},{"name":"twitter:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:site_name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:type","content":"website"},{"name":"robots","content":"index, follow"}],"scripts":{"head":"\n","body":"\n"},"baseTag":{"href":"/","target":"_self"},"alternateLinks":[{"rel":"alternate","hreflang":"x-default","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/"},{"rel":"alternate","hreflang":"en","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/"}]},"3c5cb28e-5d4e-4162-95d5-7e83237b81ae-en":{"outputDir":"./login","lang":"en","title":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI","cacheVersion":"3","meta":[{"name":"title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"itemprop":"name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"name":"twitter:card","content":"summary"},{"name":"twitter:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:site_name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:type","content":"website"},{"name":"robots","content":"index, follow"}],"scripts":{"head":"\n","body":"\n"},"baseTag":{"href":"/","target":"_self"},"alternateLinks":[{"rel":"alternate","hreflang":"x-default","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/login/"},{"rel":"alternate","hreflang":"en","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/login/"}]},"db71e742-8093-47a5-bdab-cada6af41df7-en":{"outputDir":"./forgot-password","lang":"en","title":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI","cacheVersion":"3","meta":[{"name":"title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"itemprop":"name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"name":"twitter:card","content":"summary"},{"name":"twitter:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:site_name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:type","content":"website"},{"name":"robots","content":"index, follow"}],"scripts":{"head":"\n","body":"\n"},"baseTag":{"href":"/","target":"_self"},"alternateLinks":[{"rel":"alternate","hreflang":"x-default","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/forgot-password/"},{"rel":"alternate","hreflang":"en","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/forgot-password/"}]},"7205219d-8624-46d3-aeae-6bc6d47a17f9-en":{"outputDir":"./signup","lang":"en","title":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI","cacheVersion":"3","meta":[{"name":"title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"itemprop":"name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"name":"twitter:card","content":"summary"},{"name":"twitter:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:title","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:site_name","content":"DTMS · Token Monitor & Rate Limit Console | DeepMindz AI"},{"property":"og:type","content":"website"},{"name":"robots","content":"index, follow"}],"scripts":{"head":"\n","body":"\n"},"baseTag":{"href":"/","target":"_self"},"alternateLinks":[{"rel":"alternate","hreflang":"x-default","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/signup/"},{"rel":"alternate","hreflang":"en","href":"https://14d2dd03-9b24-4303-b875-9a745bcc5f18.weweb-preview.io/signup/"}]}};

function generatePageHtmlFiles() {
    const template = fs.readFileSync(path.resolve(__dirname, 'template.html'), 'utf-8');
    const compiledTemplate = handlebars.compile(template);

    for (const pageConfig of Object.values(pages)) {
        const html = compiledTemplate({
            title: pageConfig.title,
            lang: pageConfig.lang,
            meta: pageConfig.meta,
            structuredData: pageConfig.structuredData || null,
            scripts: {
                head: pageConfig.scripts.head,
                body: pageConfig.scripts.body,
            },
            alternateLinks: pageConfig.alternateLinks,
            cacheVersion: pageConfig.cacheVersion,
            baseTag: pageConfig.baseTag,
            encodedAssetBase: encodeURIComponent("/"),
        });

        if (!fs.existsSync(pageConfig.outputDir)) {
            fs.mkdirSync(pageConfig.outputDir, { recursive: true });
        }
        fs.writeFileSync(`${pageConfig.outputDir}/index.html`, html);
    }
}

const clientInputs = {};
for (const pageName in pages) {
    clientInputs[pageName] = path.resolve(__dirname, pages[pageName].outputDir, 'index.html');
}

function getFrontEnvironmentValues(root, mode) {
    const filePath = path.resolve(root, `.env.${mode}`);
    if (!fs.existsSync(filePath)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(parseEnv(fs.readFileSync(filePath, 'utf8'))).filter(([key]) => !key.startsWith('VITE_'))
    );
}

const onwarn = (entry, next) => {
    if (entry.loc?.file && /js$/.test(entry.loc.file) && /Use of eval in/.test(entry.message)) return;
    if (/Use of direct `eval`/.test(entry.message)) return;
    return next(entry);
};

export default defineConfig(({ mode, isSsrBuild }) => {
    if (!isSsrBuild) {
        generatePageHtmlFiles();
    }

    const build = {
        chunkSizeWarningLimit: 10000,
        ...(!isSsrBuild ? { manifest: '.ww-client-manifest.json' } : {}),
        rolldownOptions: {
            ...(!isSsrBuild ? { input: clientInputs } : {}),
            onwarn,
        },
    };

    if (isSsrBuild) {
        build.outDir = 'dist-ssr';
    }

    return {
        plugins: [createSsrPageComponentLoadersPlugin(), vue()],
        base: "/",
        define: {
            global: 'globalThis',
            __VUE_PROD_DEVTOOLS__: mode === 'development',
            __VUE_PROD_HYDRATION_MISMATCH_DETAILS__:
                mode === 'development' || !!process.env.WW_BACK_URL?.includes('weweb-preprod.io'),
            __WW_FRONT_ENV_VARIABLES__: JSON.stringify({
                staging: getFrontEnvironmentValues(__dirname, 'staging'),
                production: getFrontEnvironmentValues(__dirname, 'production'),
            }),
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        css: {
            preprocessorOptions: {
                scss: {
                    api: 'modern-compiler',
                },
            },
            postcss: {
                plugins: [wewebCssLayerPlugin({ include: [/[/\\]src[/\\]extensions[/\\]/, /[/\\]node_modules[/\\]/] }), autoprefixer],
            },
        },
        ssr: {
            noExternal: true,
        },
        server: {
            port: 8080,
        },
        build,
    };
});
