# @krypticdev/daemon-client

The Kryptic daemon client for Node.js. During development startup it asks the local
Kryptic daemon for the current project's secrets and puts them on `process.env`.
In production it is a no-op. It never throws - no daemon just means your app starts
with the environment it already has.

```bash
npm install --save-dev @krypticdev/daemon-client
```

```js
// CommonJS - top of your entry point
const kryptic = require('@krypticdev/daemon-client');
kryptic.inject();

// ES modules
import { inject } from '@krypticdev/daemon-client';
await inject();

// All secrets now available:
const dbUrl = process.env.DATABASE_URL;
```

Works with any framework that reads `process.env` (Express, Fastify, NestJS, Next.js, …).

## Behavior

- No-op when `NODE_ENV` is set to anything but `development`, or `KRYPTIC_DISABLED=true`.
- Finds `kryptic.json` by walking up from the working directory.
- Never overwrites environment variables that are already set.
- Configuration via env vars: `KRYPTIC_PROJECT_ID`, `KRYPTIC_ENV`, `KRYPTIC_SOCKET_PATH`,
  `KRYPTIC_TIMEOUT_MS` (default 2000), `KRYPTIC_SILENT`.

Protocol: see [daemon/PROTOCOL.md](https://github.com/dev-kryptic/Kryptic.Daemon/blob/main/PROTOCOL.md). License: Apache-2.0.

```bash
npm test
```
