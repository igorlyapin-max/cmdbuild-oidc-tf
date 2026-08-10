import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

export const projectName = 'cmdbuild-oidc-tf';
export const userPrefix = 'cmdbuild-oidc-tf';
export const statePrefix = 'secrets/zitadel_cmdbuild_oidc_tf';

export function statePath(name) {
  return `${statePrefix}_${name}`;
}

export function readState(name) {
  const path = statePath(name);
  if (!existsSync(path)) throw new Error(`missing_zitadel_state:${path}`);
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`empty_zitadel_state:${path}`);
  return value;
}

export function writeState(name, value) {
  const path = statePath(name);
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
