const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
// Publish browser assets only; keep server source, environment examples and tests private.
const assets = ['index.html', 'style.css', 'home-alerts.js', 'database', 'staff', 'point', 'map', 'shared', 'webhook'];
fs.mkdirSync(output, { recursive: true });
for (const asset of assets) fs.cpSync(path.join(root, asset), path.join(output, asset), { recursive: true });
console.log('Static site built in dist/.');
