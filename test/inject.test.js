// Tests run against a mock daemon: a local socket server speaking PROTOCOL.md v1.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { inject, _resetCache } = require('../dist/index.js');

let server;
let tempDir;

function startMockDaemon(handler) {
  const socketPath = path.join(tempDir, 'daemon.sock');
  server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline));
      socket.write(JSON.stringify(handler(request)) + '\n');
    });
  });
  server.listen(socketPath);
  process.env.KRYPTIC_SOCKET_PATH = socketPath;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kryptic-sdk-'));
  fs.writeFileSync(path.join(tempDir, 'kryptic.json'), JSON.stringify({ projectId: 'proj_test123456' }));
  process.chdir(tempDir);
  _resetCache();

  delete process.env.NODE_ENV;
  delete process.env.KRYPTIC_DISABLED;
  delete process.env.KRYPTIC_PROJECT_ID;
  delete process.env.KRYPTIC_ENV;
  delete process.env.INJECTED_KEY;
  delete process.env.EXISTING_KEY;
  process.env.KRYPTIC_SILENT = 'true';
});

afterEach(() => {
  if (server) server.close();
  server = null;
  delete process.env.KRYPTIC_SOCKET_PATH;
});

test('injects secrets from the daemon into process.env', async () => {
  startMockDaemon((request) => {
    assert.strictEqual(request.type, 'secrets');
    assert.strictEqual(request.projectId, 'proj_test123456');
    assert.strictEqual(request.environment, 'development');
    return { v: 1, ok: true, secrets: [{ key: 'INJECTED_KEY', value: 'from-daemon' }] };
  });

  const result = await inject();

  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.injected, 1);
  assert.strictEqual(process.env.INJECTED_KEY, 'from-daemon');
});

test('never overwrites existing environment variables', async () => {
  process.env.EXISTING_KEY = 'real-env-wins';
  startMockDaemon(() => ({ v: 1, ok: true, secrets: [{ key: 'EXISTING_KEY', value: 'from-daemon' }] }));

  const result = await inject();

  assert.strictEqual(result.injected, 0);
  assert.strictEqual(process.env.EXISTING_KEY, 'real-env-wins');
});

test('is a silent no-op when the daemon is not running', async () => {
  process.env.KRYPTIC_SOCKET_PATH = path.join(tempDir, 'missing.sock');

  const result = await inject();

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'daemon_unreachable');
});

test('is a no-op outside development (NODE_ENV=production)', async () => {
  process.env.NODE_ENV = 'production';

  const result = await inject();

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'node_env_production');
});

test('is a no-op when KRYPTIC_DISABLED=true', async () => {
  process.env.KRYPTIC_DISABLED = 'true';

  const result = await inject();

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'disabled');
});

test('handles daemon error responses without throwing', async () => {
  startMockDaemon(() => ({ v: 1, ok: false, error: 'access_denied', message: 'no access' }));

  const result = await inject();

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'access_denied');
});

test('KRYPTIC_PROJECT_ID and KRYPTIC_ENV override kryptic.json', async () => {
  process.env.KRYPTIC_PROJECT_ID = 'proj_override0001';
  process.env.KRYPTIC_ENV = 'staging';

  let seen;
  startMockDaemon((request) => {
    seen = request;
    return { v: 1, ok: true, secrets: [] };
  });

  await inject();

  assert.strictEqual(seen.projectId, 'proj_override0001');
  assert.strictEqual(seen.environment, 'staging');
});
