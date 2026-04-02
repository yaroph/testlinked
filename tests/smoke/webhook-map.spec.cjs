const { test, expect } = require('@playwright/test');
const { installNetlifyMocks } = require('./helpers.cjs');

test('webhook map affiche les detections chargees depuis /api/webhook-detection', async ({ page }) => {
    await installNetlifyMocks(page, {
        webhookDetections: [
            {
                id: 'wh-2',
                player: 'Bravo',
                x: 210,
                y: 840,
                z: 14,
                type: 'prediction',
                timestamp: 1710000300,
                timestampMs: 1710000300000,
                detectedAt: '2024-03-09T16:05:00.000Z',
                receivedAt: '2026-04-02T10:05:00.000Z',
                receivedAtMs: Date.parse('2026-04-02T10:05:00.000Z'),
            },
            {
                id: 'wh-1',
                player: 'Atlas',
                x: 123.45,
                y: 678.9,
                z: 21,
                type: 'detection',
                timestamp: 1710000000,
                timestampMs: 1710000000000,
                detectedAt: '2024-03-09T16:00:00.000Z',
                receivedAt: '2026-04-02T10:00:00.000Z',
                receivedAtMs: Date.parse('2026-04-02T10:00:00.000Z'),
            },
        ],
    });

    await page.goto('/webhook/map/');
    await expect(page.locator('#mapViewport')).toBeVisible();
    await expect(page.locator('.map-marker')).toHaveCount(2);
    await expect(page.locator('#statsCount')).toHaveText('2');

    await page.click('.map-marker.is-prediction');
    await expect(page.locator('#detailsCard')).toContainText('Bravo');
    await expect(page.locator('#detailsCard')).toContainText('Prédiction');
});

test('webhook map filtre les detections par type', async ({ page }) => {
    await installNetlifyMocks(page, {
        webhookDetections: [
            {
                id: 'wh-2',
                player: 'Bravo',
                x: 210,
                y: 840,
                z: 14,
                type: 'prediction',
                timestamp: 1710000300,
                timestampMs: 1710000300000,
                detectedAt: '2024-03-09T16:05:00.000Z',
                receivedAt: '2026-04-02T10:05:00.000Z',
                receivedAtMs: Date.parse('2026-04-02T10:05:00.000Z'),
            },
            {
                id: 'wh-1',
                player: 'Atlas',
                x: 123.45,
                y: 678.9,
                z: 21,
                type: 'detection',
                timestamp: 1710000000,
                timestampMs: 1710000000000,
                detectedAt: '2024-03-09T16:00:00.000Z',
                receivedAt: '2026-04-02T10:00:00.000Z',
                receivedAtMs: Date.parse('2026-04-02T10:00:00.000Z'),
            },
        ],
    });

    await page.goto('/webhook/map/');
    await expect(page.locator('.map-marker')).toHaveCount(2);

    await page.selectOption('#typeFilter', 'prediction');
    await expect(page.locator('.map-marker')).toHaveCount(1);
    await expect(page.locator('#detectionsList')).toContainText('Bravo');
    await expect(page.locator('#detectionsList')).not.toContainText('Atlas');
});

test('webhook map permet le deplacement de la carte au clic-glisse', async ({ page }) => {
    await installNetlifyMocks(page, {
        webhookDetections: [
            {
                id: 'wh-1',
                player: 'Atlas',
                x: 123.45,
                y: 678.9,
                z: 21,
                type: 'detection',
                timestamp: 1710000000,
                timestampMs: 1710000000000,
                detectedAt: '2024-03-09T16:00:00.000Z',
                receivedAt: '2026-04-02T10:00:00.000Z',
                receivedAtMs: Date.parse('2026-04-02T10:00:00.000Z'),
            },
        ],
    });

    await page.goto('/webhook/map/');
    await expect(page.locator('#mapViewport')).toBeVisible();

    const before = await page.locator('#map-world').evaluate((element) => getComputedStyle(element).transform);
    const viewport = page.locator('#viewport');
    const box = await viewport.boundingBox();
    if (!box) throw new Error('Viewport not available');

    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.62, { steps: 8 });
    await page.mouse.up();

    const after = await page.locator('#map-world').evaluate((element) => getComputedStyle(element).transform);
    expect(after).not.toBe(before);
});
