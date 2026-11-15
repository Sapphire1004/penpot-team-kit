import { randomBytes } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
if (await access('.env').then(() => true, () => false)) throw new Error('.env already exists; it was not overwritten.');
const port = process.env.PENPOT_PORT || '9001';
if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) throw new Error('Invalid PENPOT_PORT.');
const uri = new URL(process.env.PENPOT_PUBLIC_URI || `http://localhost:${port}`);
if (!['http:', 'https:'].includes(uri.protocol) || uri.username || uri.password || uri.search || uri.hash) throw new Error('Use an HTTP(S) public origin without credentials.');
const project = process.env.COMPOSE_PROJECT_NAME || 'penpot-team-kit';
const bind = process.env.PENPOT_BIND_ADDRESS || '127.0.0.1';
if (!/^[a-z0-9][a-z0-9_-]*$/.test(project) || !/^[\da-fA-F.:]+$/.test(bind)) throw new Error('Invalid Compose project or bind address.');
const flags = ['disable-registration', 'enable-login-with-password', 'disable-email-verification', uri.protocol === 'https:' ? 'enable-secure-session-cookies' : 'disable-secure-session-cookies', 'disable-smtp', 'disable-log-emails', 'disable-admin-console', 'enable-mcp'];
const content = [
  `COMPOSE_PROJECT_NAME=${project}`, 'PENPOT_VERSION=2.18.5',
  `PENPOT_PUBLIC_URI=${uri.origin}`, `PENPOT_BIND_ADDRESS=${bind}`, `PENPOT_PORT=${port}`,
  `PENPOT_SECRET_KEY=${randomBytes(64).toString('base64url')}`,
  `PENPOT_DATABASE_PASSWORD=${randomBytes(32).toString('hex')}`,
  `PENPOT_FLAGS=${flags.join(' ')}`, `LOCAL_UID=${process.getuid?.() ?? 1000}`, `LOCAL_GID=${process.getgid?.() ?? 1000}`, '',
].join('\n');
await writeFile('.env', content, { mode: 0o600, flag: 'wx' });
console.log(`Created private .env. Open ${uri.origin} after ./penpot up. Secrets were not printed.`);
