const baseUrl = process.env.MCP_SMOKE_URL ?? 'http://127.0.0.1:18100';

const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
if (!metadata.ok) throw new Error(`metadata returned ${metadata.status}`);
const resource = await metadata.json();
if (!Array.isArray(resource.authorization_servers) || resource.authorization_servers.length !== 1) {
  throw new Error('resource metadata has no authorization server');
}

const unauthorized = await fetch(`${baseUrl}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '0.1.0' } } })
});
if (unauthorized.status !== 401) throw new Error(`unauthenticated MCP returned ${unauthorized.status}`);
const challenge = unauthorized.headers.get('www-authenticate') ?? '';
if (!challenge.includes('resource_metadata=')) throw new Error('missing OAuth resource metadata challenge');

console.log(JSON.stringify({ status: 'ok', authorization_server: resource.authorization_servers[0], unauthenticated_status: unauthorized.status }));
