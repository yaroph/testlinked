const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../netlify/functions/alerts.js');

test('normalizeAlert nettoie la whitelist et resume les cercles en une alerte publique coherente', () => {
  const previous = {
    id: 'alert_1',
    createdAt: '2026-03-10T08:00:00.000Z',
    updatedAt: '2026-03-10T08:00:00.000Z',
    activeCircleIndex: 0,
    circles: [
      { xPercent: 10, yPercent: 10, gpsX: 1, gpsY: 1, radius: 1.5 },
    ],
  };

  const normalized = __test.normalizeAlert({
    title: 'Intervention secteur nord',
    description: 'Equipe en mouvement',
    visibilityMode: 'whitelist',
    allowedUsers: [' Alice ', 'alice', 'b@d!', 'xy'],
    circles: [
      { xPercent: 20, yPercent: 30, gpsX: 12.5, gpsY: 48.1, radius: 2.5 },
      { xPercent: 30, yPercent: 40, gpsX: 13.5, gpsY: 49.1, radius: 3.5 },
    ],
    activeCircleIndex: 99,
    startsAt: '2026-03-11T14:30:00',
    showBeforeStart: true,
    active: true,
  }, previous);

  assert.equal(normalized.id, 'alert_1');
  assert.equal(normalized.shapeType, 'circle');
  assert.equal(normalized.circles.length, 2);
  assert.equal(normalized.activeCircleIndex, 1);
  assert.deepEqual(normalized.allowedUsers, ['alice']);
  assert.match(normalized.startsAt, /Z$/);
  assert.equal(normalized.showBeforeStart, true);
  assert.equal(normalized.gpsX, 13);
  assert.equal(normalized.gpsY, 48.6);
  assert.equal(normalized.radius, 3.5);
});

test('normalizeAlert conserve le trait global et les rayons des cercles', () => {
  const normalized = __test.normalizeAlert({
    title: 'Multi cercle',
    description: 'Deux zones de surveillance',
    strokeWidth: 0.23,
    circles: [
      { xPercent: 20, yPercent: 25, gpsX: 10.1, gpsY: 44.1, radius: 1.8 },
      { xPercent: 42, yPercent: 48, gpsX: 12.4, gpsY: 46.8, radius: 4.6 },
    ],
    activeCircleIndex: 0,
    active: true,
  });

  assert.equal(normalized.strokeWidth, 0.23);
  assert.equal(normalized.activeCircleIndex, 0);
  assert.equal(normalized.circles.length, 2);
  assert.equal(normalized.circles[0].radius, 1.8);
  assert.equal(normalized.circles[1].radius, 4.6);
});

test('listPublicAlerts expose une alerte future si showBeforeStart est actif', () => {
  const futureDate = new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString();
  const visibleAlert = __test.normalizeAlert({
    title: 'Projection visible',
    description: 'Alerte deja affichee',
    circles: [
      { xPercent: 22, yPercent: 35, gpsX: 11.5, gpsY: 47.3, radius: 2.4 },
    ],
    startsAt: futureDate,
    showBeforeStart: true,
    active: true,
  });
  const hiddenAlert = __test.normalizeAlert({
    title: 'Projection cachee',
    description: 'Alerte en attente',
    circles: [
      { xPercent: 26, yPercent: 41, gpsX: 12.1, gpsY: 48.1, radius: 2.1 },
    ],
    startsAt: futureDate,
    showBeforeStart: false,
    active: true,
  });

  const publicAlerts = __test.listPublicAlerts([hiddenAlert, visibleAlert], null, { includeScheduled: false });

  assert.equal(publicAlerts.length, 1);
  assert.equal(publicAlerts[0].title, 'Projection visible');
  assert.equal(publicAlerts[0].scheduled, true);
  assert.equal(publicAlerts[0].showBeforeStart, true);
});

test('listPublicAlerts n expose pas une alerte future en mode attendre meme avec includeScheduled', () => {
  const futureDate = new Date(Date.now() + (48 * 60 * 60 * 1000)).toISOString();
  const hiddenAlert = __test.normalizeAlert({
    title: 'Projection cachee',
    description: 'Alerte en attente',
    circles: [
      { xPercent: 26, yPercent: 41, gpsX: 12.1, gpsY: 48.1, radius: 2.1 },
    ],
    startsAt: futureDate,
    showBeforeStart: false,
    active: true,
  });
  const visibleAlert = __test.normalizeAlert({
    title: 'Projection visible',
    description: 'Alerte deja affichee',
    circles: [
      { xPercent: 22, yPercent: 35, gpsX: 11.5, gpsY: 47.3, radius: 2.4 },
    ],
    startsAt: futureDate,
    showBeforeStart: true,
    active: true,
  });

  const publicAlerts = __test.listPublicAlerts([hiddenAlert, visibleAlert], null, { includeScheduled: true });

  assert.equal(publicAlerts.length, 1);
  assert.equal(publicAlerts[0].title, 'Projection visible');
  assert.equal(publicAlerts[0].showBeforeStart, true);
});
