import { defineConfig } from 'tsdown';

export default defineConfig({
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node24',
    fixedExtension: true,
    clean: true,
    minify: true,
    sourcemap: false,
    deps: {
        alwaysBundle: [/.*/],
        onlyBundle: false,
        // Resend loads this optional peer only for React email inputs, which our action does not expose.
        onlyImport: ['@react-email/render'],
    },
    outputOptions: output => ({
        ...output,
        codeSplitting: false,
    }),
});
