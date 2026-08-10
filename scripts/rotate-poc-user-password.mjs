import { chmodSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const role = process.argv[2];
if (!['editor', 'reader'].includes(role)) {
  throw new Error('usage: rotate-poc-user-password.mjs <editor|reader>');
}

// The fixed suffix guarantees the ZITADEL Basic password policy while the
// random component remains the actual secret. The value is never printed.
const password = `${randomBytes(27).toString('base64url')}aA1!`;
const path = `secrets/zitadel_cmdbuild_oidc_tf_${role}_password`;
writeFileSync(path, `${password}\n`, { mode: 0o600 });
chmodSync(path, 0o600);
console.log(JSON.stringify({ role, rotated: true, length: password.length }));
