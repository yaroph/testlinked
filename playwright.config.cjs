const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);

module.exports = defineConfig({
    testDir: './tests/smoke',
    timeout: 30000,
    expect: {
        timeout: 6000,
    },
    fullyParallel: true,
    reporter: 'line',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        headless: true,
        viewport: { width: 1440, height: 960 },
        trace: 'retain-on-failure',
    },
    webServer: {
        command: `node tests/smoke/static-server.cjs --port ${PORT}`,
        port: PORT,
        reuseExistingServer: !process.env.CI,
    },
});
