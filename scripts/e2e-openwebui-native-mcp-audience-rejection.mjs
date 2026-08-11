import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'reject';
if (!['reject', 'accept'].includes(mode)) throw new Error('usage: e2e-openwebui-native-mcp-audience-rejection.mjs [reject|accept]');
const expectedStatus = mode === 'reject' ? 401 : 200;

const python = String.raw`
import json
import sys
import urllib.error
import urllib.request

from open_webui.models.oauth_sessions import OAuthSessions
from open_webui.models.users import Users

username = 'cmdbuild-oidc-tf-reader'
provider = 'mcp:cmdbuild-oidc-tf-native-mcp'
user = Users.get_user_by_email(f'{username}@openwebui.192.168.202.35')
if user is None:
    raise RuntimeError('openwebui_poc_user_missing')
session = OAuthSessions.get_session_by_provider_and_user_id(provider, user.id)
if session is None or not isinstance(session.token.get('access_token'), str):
    raise RuntimeError('openwebui_native_mcp_oauth_session_missing')

request = urllib.request.Request(
    'http://192.168.202.35:8085/mcp',
    data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'audience-negative-test', 'version': '1'}}}).encode(),
    headers={'Accept': 'application/json, text/event-stream', 'Authorization': f"Bearer {session.token['access_token']}", 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-03-26'},
    method='POST',
)
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        status = response.status
except urllib.error.HTTPError as error:
    status = error.code
expected_status = ${expectedStatus}
if status != expected_status:
    print(json.dumps({'status': 'failed', 'mode': '${mode}', 'mcp_initialize_status': status}))
    sys.exit(2)
print(json.dumps({'status': 'passed', 'mode': '${mode}', 'mcp_initialize_status': status}))
`;

const encodedPython = Buffer.from(python).toString('base64');
const command = [
  'export OAUTH_CLIENT_ID="$(cat /run/secrets/openwebui_oidc_client_id)";',
  'export OAUTH_CLIENT_SECRET="$(cat /run/secrets/openwebui_oidc_client_secret)";',
  'export WEBUI_SECRET_KEY="$(cat /run/secrets/openwebui_webui_secret_key)";',
  `python -c "import base64; exec(compile(base64.b64decode('${encodedPython}'), '<audience-negative-test>', 'exec'))"`
].join(' ');
const execution = spawnSync('docker', ['exec', '-i', 'openwebui', 'sh', '-lc', command], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
});
const result = execution.stdout.trim().split(/\r?\n/).at(-1);
if (execution.status !== 0) throw new Error(result ? `openwebui_native_mcp_audience_test_failed:${result}` : 'openwebui_native_mcp_audience_test_failed');
if (!result) throw new Error('openwebui_native_mcp_wrong_audience_test_no_output');
console.log(result);
