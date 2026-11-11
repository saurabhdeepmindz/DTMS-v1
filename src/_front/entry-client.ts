// Install the serialized SSR environment before evaluating the application module
// and its dependency graph. Normal CSR pages have no environment to install.
import './rendering/prerenderBootstrap';

await import('./main.js');
