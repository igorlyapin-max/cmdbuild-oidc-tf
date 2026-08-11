import { spawnSync } from 'node:child_process';

const role = process.argv[2] ?? 'reader';
if (!['reader', 'editor'].includes(role)) {
  throw new Error('usage: inspect-openwebui-native-mcp-token.mjs [reader|editor]');
}

const python = String.raw`
import base64
import hashlib
import json
import sys
from open_webui.models.oauth_sessions import OAuthSessions
from open_webui.models.users import Users

role = json.load(sys.stdin)['role']
username = f'cmdbuild-oidc-tf-{role}'
user = Users.get_user_by_email(f'{username}@openwebui.192.168.202.35')
if user is None:
    raise RuntimeError('openwebui_poc_user_missing')
session = OAuthSessions.get_session_by_provider_and_user_id('mcp:cmdbuild-oidc-tf-native-mcp', user.id)
if session is None:
    raise RuntimeError('openwebui_native_mcp_oauth_session_missing')
token = session.token.get('access_token')
if not isinstance(token, str):
    raise RuntimeError('openwebui_native_mcp_access_token_missing')
parts = token.split('.')
if len(parts) < 2:
    raise RuntimeError('openwebui_native_mcp_access_token_not_jwt')
payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
subject = payload.get('sub')
print(json.dumps({
    'role': role,
    'issuer': payload.get('iss'),
    'audience': payload.get('aud'),
    'subject_hash': hashlib.sha256(subject.encode()).hexdigest()[:16] if isinstance(subject, str) else None,
    'groups': payload.get('cmdbuild_oidc_tf_groups'),
    'scope': payload.get('scope'),
    'expires_at': payload.get('exp'),
}))
`;
const encoded = Buffer.from(python).toString('base64');
const command = [
  'export OAUTH_CLIENT_ID="$(cat /run/secrets/openwebui_oidc_client_id)";',
  'export OAUTH_CLIENT_SECRET="$(cat /run/secrets/openwebui_oidc_client_secret)";',
  'export WEBUI_SECRET_KEY="$(cat /run/secrets/openwebui_webui_secret_key)";',
  `python -c "import base64; exec(compile(base64.b64decode('${encoded}'), '<openwebui-native-mcp-token>', 'exec'))"`,
].join(' ');
const execution = spawnSync('docker', ['exec', '-i', 'openwebui', 'sh', '-lc', command], {
  input: JSON.stringify({ role }),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe'],
});
if (execution.status !== 0) {
  const code = String(execution.stderr ?? '').match(/openwebui_native_mcp_[a-z_]+/)?.[0];
  throw new Error(code ?? 'openwebui_native_mcp_token_inspection_failed');
}
const stdout = execution.stdout;
const output = stdout.trim().split(/\r?\n/).at(-1);
if (!output) throw new Error('openwebui_native_mcp_token_inspection_no_output');
console.log(output);
