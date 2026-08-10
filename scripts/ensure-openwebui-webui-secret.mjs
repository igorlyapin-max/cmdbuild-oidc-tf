import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const path = '/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/openwebui_webui_secret_key';
if (existsSync(path) && readFileSync(path, 'utf8').trim()) {
  chmodSync(path, 0o600);
  console.log(JSON.stringify({ secret: 'openwebui_webui_secret_key', status: 'already_exists' }));
} else {
  writeFileSync(path, `${randomBytes(48).toString('base64url')}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(JSON.stringify({ secret: 'openwebui_webui_secret_key', status: 'created' }));
}
