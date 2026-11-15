import assert from 'node:assert/strict';
export async function checkMcp(origin) {
  let session;
  async function rpc(method, params, id) {
    const response = await fetch(origin + '/mcp/stream', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2024-11-05' } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
    });
    if (response.headers.has('mcp-session-id')) session = response.headers.get('mcp-session-id');
    const text = await response.text();
    assert.ok(response.ok, `MCP ${method}: HTTP ${response.status}`);
    if (!text || id === undefined) return null;
    let data;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))).find(message => message.id === id);
    } else data = JSON.parse(text);
    assert.ok(data && !data.error, `MCP ${method} failed`);
    return data.result;
  }
  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'penpot-team-kit-test', version: '1.0.0' } }, 1);
    await rpc('notifications/initialized', {});
    const catalog = await rpc('tools/list', {}, 2);
    assert.ok(catalog.tools.some(t => t.name === 'execute_code'));
    const result = await rpc('tools/call', { name: 'execute_code', arguments: { code: 'return {version:penpot.version};' } }, 3);
    const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    assert.match(text, /No userToken.*authentication/i);
    return { toolNames: catalog.tools.map(t => t.name), unauthenticatedDesignOperationRejected: true };
  } finally {
    if (session) await fetch(origin + '/mcp/stream', { method: 'DELETE', headers: { 'mcp-session-id': session }, signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
}
