import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import eslintPluginPrettier from 'eslint-plugin-prettier/recommended';

export default [
    // Global ignores
    {
        ignores: ['dist/**', 'node_modules/**', '**/*.min.js'],
    },

    // Base JS recommended rules
    js.configs.recommended,

    // TypeScript
    ...tseslint.configs.recommended,

    // Vue
    ...pluginVue.configs['flat/recommended'],

    // Prettier (must be last to override formatting rules)
    eslintPluginPrettier,

    // Global settings for all files
    {
        languageOptions: {
            globals: {
                wwLib: 'readonly',
                Stripe: 'readonly',
                _: 'readonly',
                axios: 'readonly',
                wwAxios: 'readonly',
                wwServerClient: 'readonly',
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                requestAnimationFrame: 'readonly',
                cancelAnimationFrame: 'readonly',
                getComputedStyle: 'readonly',
                fetch: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
                history: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                MutationObserver: 'readonly',
                ResizeObserver: 'readonly',
                IntersectionObserver: 'readonly',
                HTMLElement: 'readonly',
                HTMLInputElement: 'readonly',
                CustomEvent: 'readonly',
                Event: 'readonly',
                KeyboardEvent: 'readonly',
                ClipboardEvent: 'readonly',
                FocusEvent: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                TextEncoder: 'readonly',
                Blob: 'readonly',
                FormData: 'readonly',
                AbortController: 'readonly',
                crypto: 'readonly',
                performance: 'readonly',
                structuredClone: 'readonly',
                queueMicrotask: 'readonly',
                btoa: 'readonly',
                atob: 'readonly',
                self: 'readonly',
                globalThis: 'readonly',
                process: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                Buffer: 'readonly',
            },
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [{ group: ['lodash', 'lodash/*'], message: 'Use lodash-es instead.' }],
                },
            ],
            'no-restricted-modules': [
                'error',
                {
                    paths: [{ name: 'lodash', message: 'Use lodash-es instead.' }],
                    patterns: ['lodash/*'],
                },
            ],
            semi: ['warn', 'always'],
            quotes: ['warn', 'single', { avoidEscape: true }],
            'no-console': 'warn',
            'no-unused-vars': 'warn',
            'no-empty': 'warn',
            'no-unreachable': 'warn',
            'no-async-promise-executor': 'warn',
            'no-case-declarations': 'warn',
            'no-useless-escape': 'warn',
            'no-inner-declarations': 'warn',
            'no-prototype-builtins': 'warn',
            'no-debugger': 'warn',
            'vue/no-side-effects-in-computed-properties': 'warn',
            'vue/component-definition-name-casing': 'off',
            'vue/custom-event-name-casing': 'off',
            'vue/v-on-event-hyphenation': 'off',
        },
    },

    // Vue files — use vue-eslint-parser with TS support
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
                ecmaVersion: 2022,
                sourceType: 'module',
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'off',
            'no-unused-vars': 'off',
        },
    },

    // TypeScript files
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'off',
            'no-unused-vars': 'off',
        },
    },

    // JS files — disable TS rules that don't apply
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        rules: {
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
];
