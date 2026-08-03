// Kryptic Node.js SDK. One job: during development startup, fetch the current
// project's secrets from the local Kryptic daemon and put them on process.env.
// Follows daemon/PROTOCOL.md v1. Never throws — a missing daemon means the app
// simply starts with whatever environment it already has.

import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const PROTOCOL_VERSION = 1;

export interface InjectOptions {
  /** Override the environment (default: kryptic.json defaultEnvironment, then "development"). */
  environment?: string;
  /** Override the project id from kryptic.json. */
  projectId?: string;
  /** Daemon connection timeout in ms (default 2000, or KRYPTIC_TIMEOUT_MS). */
  timeoutMs?: number;
}

export interface InjectResult {
  injected: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Fetches secrets from the daemon and injects them into process.env.
 * Existing environment variables are never overwritten.
 */
export async function inject(options: InjectOptions = {}): Promise<InjectResult> {
  const skipReason = shouldSkip();
  if (skipReason) return { injected: 0, skipped: true, reason: skipReason };

  const projectId = options.projectId ?? process.env.KRYPTIC_PROJECT_ID ?? findKrypticJson()?.projectId;
  if (!projectId) {
    warn('no kryptic.json found (and no KRYPTIC_PROJECT_ID set) — nothing to inject.');
    return { injected: 0, skipped: true, reason: 'no_project' };
  }

  const environment =
    options.environment ??
    process.env.KRYPTIC_ENV ??
    findKrypticJson()?.defaultEnvironment ??
    'development';

  const timeoutMs = options.timeoutMs ?? Number(process.env.KRYPTIC_TIMEOUT_MS ?? 2000);

  let response: DaemonResponse;
  try {
    response = await request({ v: PROTOCOL_VERSION, type: 'secrets', projectId, environment }, timeoutMs);
  } catch (e) {
    warn(`daemon not reachable (${(e as Error).message}) — continuing without injected secrets.`);
    return { injected: 0, skipped: true, reason: 'daemon_unreachable' };
  }

  if (!response.ok) {
    warn(`daemon refused the request (${response.error}): ${response.message ?? ''}`);
    return { injected: 0, skipped: true, reason: response.error };
  }

  let injected = 0;
  for (const secret of response.secrets ?? []) {
    if (process.env[secret.key] !== undefined) continue; // real environment always wins
    process.env[secret.key] = secret.value;
    injected++;
  }

  return { injected, skipped: false };
}

// ---------- internals ----------

interface DaemonResponse {
  ok: boolean;
  error?: string;
  message?: string;
  secrets?: { key: string; value: string }[];
}

function shouldSkip(): string | null {
  if (process.env.KRYPTIC_DISABLED === 'true') return 'disabled';

  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== undefined && nodeEnv !== 'development') return `node_env_${nodeEnv}`;

  return null;
}

function socketPath(): string {
  if (process.env.KRYPTIC_SOCKET_PATH) return process.env.KRYPTIC_SOCKET_PATH;
  if (process.platform === 'win32') return '\\\\.\\pipe\\kryptic-daemon';

  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (process.platform === 'linux' && runtimeDir) return path.join(runtimeDir, 'kryptic-daemon.sock');
  return '/tmp/kryptic-daemon.sock';
}

function request(payload: object, timeoutMs: number): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath());
    let buffer = '';
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const timer = setTimeout(() => fail(new Error('timeout')), timeoutMs);

    socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;

      clearTimeout(timer);
      settled = true;
      socket.end();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch {
        reject(new Error('invalid response'));
      }
    });
    socket.on('close', () => fail(new Error('connection closed')));
  });
}

interface KrypticJson {
  projectId?: string;
  defaultEnvironment?: string;
}

let cachedKrypticJson: KrypticJson | null | undefined;

/** Walks up from cwd looking for kryptic.json (cached per process). */
function findKrypticJson(): KrypticJson | null {
  if (cachedKrypticJson !== undefined) return cachedKrypticJson;

  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, 'kryptic.json');
    if (fs.existsSync(candidate)) {
      try {
        cachedKrypticJson = JSON.parse(fs.readFileSync(candidate, 'utf8')) as KrypticJson;
        return cachedKrypticJson;
      } catch {
        warn(`could not parse ${candidate} — ignoring it.`);
        break;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedKrypticJson = null;
  return null;
}

/** Test hook: clears the kryptic.json cache. */
export function _resetCache(): void {
  cachedKrypticJson = undefined;
}

function warn(message: string): void {
  if (process.env.KRYPTIC_SILENT === 'true') return;
  console.warn(`[kryptic] ${message}`);
}

export default { inject };
