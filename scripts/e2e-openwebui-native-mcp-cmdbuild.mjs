import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const role = process.argv[2] ?? 'reader';
if (!['reader', 'editor'].includes(role)) {
  throw new Error('usage: e2e-openwebui-native-mcp-cmdbuild.mjs [reader|editor]');
}

const python = String.raw`
import asyncio
import json
import sys
import uuid

from open_webui.models.oauth_sessions import OAuthSessions
from open_webui.models.users import Users
from open_webui.utils.mcp.client import MCPClient

input_data = json.load(sys.stdin)
role = input_data['role']
expected_subject = input_data['expected_subject']
username = f'cmdbuild-oidc-tf-{role}'
provider = 'mcp:cmdbuild-oidc-tf-native-mcp'

def payload(content):
    if not isinstance(content, list) or not content:
        raise RuntimeError('mcp_result_content_missing')
    text = content[0].get('text') if isinstance(content[0], dict) else None
    if not isinstance(text, str):
        raise RuntimeError('mcp_result_text_missing')
    return json.loads(text)

def successful_payload(result):
    if isinstance(result, dict) and result.get('isError'):
        raise RuntimeError(f"mcp_tool_error:{json.dumps(result, sort_keys=True)}")
    content = result.get('content') if isinstance(result, dict) else result
    return payload(content)

def username(value):
    if isinstance(value, dict):
        data = value.get('data')
        if isinstance(data, dict) and isinstance(data.get('username'), str):
            return data['username']
    return None

def find_description(value):
    if isinstance(value, dict):
        if isinstance(value.get('Description'), str) and value['Description']:
            return value['Description']
        for nested in value.values():
            found = find_description(nested)
            if found is not None:
                return found
    if isinstance(value, list):
        for nested in value:
            found = find_description(nested)
            if found is not None:
                return found
    return None

async def run():
    user = Users.get_user_by_email(f'{username}@openwebui.192.168.202.35')
    if user is None:
        raise RuntimeError('openwebui_poc_user_missing')
    session = OAuthSessions.get_session_by_provider_and_user_id(provider, user.id)
    if session is None or not isinstance(session.token.get('access_token'), str):
        raise RuntimeError('openwebui_native_mcp_oauth_session_missing')

    client = MCPClient()
    try:
        await client.connect('http://192.168.202.35:8085/mcp', headers={
            'Authorization': f"Bearer {session.token['access_token']}"
        })
        specs = await client.list_tool_specs()
        names = {spec['name'] for spec in specs or []}
        expected_names = {'cmdbuild_whoami', 'cmdbuild_read_demo_cards', 'cmdbuild_update_demo_card'}
        if names != expected_names:
            raise RuntimeError('openwebui_native_mcp_tools_not_exact')

        whoami = await client.call_tool('cmdbuild_whoami', {})
        if username(successful_payload(whoami)) != expected_subject:
            raise RuntimeError('cmdbuild_identity_does_not_match_openwebui_user')
        cards = await client.call_tool('cmdbuild_read_demo_cards', {'limit': 1})
        cards_payload = successful_payload(cards)
        if role == 'reader':
            denied = False
            try:
                rejected = await client.call_tool('cmdbuild_update_demo_card', {
                    'attribute': 'Description',
                    'value': f'reader-denied-{uuid.uuid4()}',
                })
                denied = isinstance(rejected, dict) and rejected.get('isError') is True and 'group_does_not_allow_write' in json.dumps(rejected, sort_keys=True)
            except Exception as error:
                denied = 'group_does_not_allow_write' in str(error)
            if not denied:
                raise RuntimeError('reader_mcp_write_was_not_denied')
            return {'role': role, 'whoami': 'matched', 'read': 'ok', 'write': 'denied'}

        original = find_description(cards_payload)
        if original is None:
            raise RuntimeError('editor_demo_card_description_missing')
        marker = f'cmdbuild-oidc-tf-openwebui-{uuid.uuid4()}'
        successful_payload(await client.call_tool('cmdbuild_update_demo_card', {'attribute': 'Description', 'value': marker}))
        try:
            updated = await client.call_tool('cmdbuild_read_demo_cards', {'limit': 1})
            if find_description(successful_payload(updated)) != marker:
                raise RuntimeError('editor_mcp_update_readback_failed')
        finally:
            restored = await client.call_tool('cmdbuild_update_demo_card', {'attribute': 'Description', 'value': original})
            successful_payload(restored)
        rolled_back = await client.call_tool('cmdbuild_read_demo_cards', {'limit': 1})
        if find_description(successful_payload(rolled_back)) != original:
            raise RuntimeError('editor_mcp_rollback_readback_failed')
        return {'role': role, 'whoami': 'matched', 'read': 'ok', 'update': 'ok', 'rollback': 'ok'}
    finally:
        if getattr(client, 'exit_stack', None):
            await client.disconnect()

try:
    print(json.dumps(asyncio.run(run())))
except RuntimeError as error:
    print(json.dumps({'status': 'failed', 'error_code': str(error)}))
    raise
except Exception as error:
    print(json.dumps({'status': 'failed', 'error_type': type(error).__name__}))
    raise
`;

const encodedPython = Buffer.from(python).toString('base64');
const command = [
  'export OAUTH_CLIENT_ID="$(cat /run/secrets/openwebui_oidc_client_id)";',
  'export OAUTH_CLIENT_SECRET="$(cat /run/secrets/openwebui_oidc_client_secret)";',
  'export WEBUI_SECRET_KEY="$(cat /run/secrets/openwebui_webui_secret_key)";',
  `python -c "import base64; exec(compile(base64.b64decode('${encodedPython}'), '<openwebui-native-mcp-poc>', 'exec'))"`,
].join(' ');

const execution = spawnSync('docker', ['exec', '-i', 'openwebui', 'sh', '-lc', command], {
  input: JSON.stringify({
    role,
    expected_subject: readFileSync(`secrets/zitadel_cmdbuild_oidc_tf_${role}_user_id`, 'utf8').trim()
  }),
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'ignore'],
});
if (execution.status !== 0) {
  const diagnostic = execution.stdout.trim().split(/\r?\n/).at(-1);
  throw new Error(diagnostic ? `openwebui_native_mcp_poc_failed:${diagnostic}` : 'openwebui_native_mcp_poc_failed');
}
const stdout = execution.stdout;
const output = stdout.trim().split(/\r?\n/).at(-1);
if (!output) throw new Error('openwebui_native_mcp_poc_no_output');
const result = JSON.parse(output);
console.log(JSON.stringify({ status: 'passed', ...result }));
