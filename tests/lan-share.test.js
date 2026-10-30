// tests/lan-share.test.js — run after `npm run build:electron`
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveInside } = require('../dist-electron/lan-share');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanshare-'));
fs.mkdirSync(path.join(root, 'sub'));
fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'x');
const outside = path.join(path.dirname(root), path.basename(root) + '-secret.txt');
fs.writeFileSync(outside, 'secret');

assert.strictEqual(resolveInside(root, ''), fs.realpathSync(root));
assert.strictEqual(resolveInside(root, 'sub/a.txt'), fs.realpathSync(path.join(root, 'sub', 'a.txt')));
assert.strictEqual(resolveInside(root, '../' + path.basename(outside)), null);
assert.strictEqual(resolveInside(root, 'sub/../../' + path.basename(outside)), null);
assert.strictEqual(resolveInside(root, outside), null);
assert.strictEqual(resolveInside(root, 'missing.txt'), null);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(outside, { force: true });
console.log('[PASS] lan-share resolveInside blocks paths outside the shared folder');
