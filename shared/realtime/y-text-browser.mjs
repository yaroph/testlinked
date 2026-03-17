export * from './y-text.mjs';

export async function preloadBrowserYTextTools() {
    return import('./y-text.mjs');
}
