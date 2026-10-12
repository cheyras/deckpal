import { InMemoryTransport, LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from '@modelcontextprotocol/server';
import type { Ctx } from '@deckpal/agent-tools';
import type { ToolVisibility } from '../adapters/mcp.js';
import { buildServer } from '../server.js';

/**
 * A minimal JSON-RPC client wired to {@link buildServer} over the SDK's
 * in-memory transport. It is the same exchange a real client has over HTTP,
 * minus the socket: `initialize`, then whatever requests the caller sends.
 *
 * Used by `pnpm mcp:audit` (which measures what `tools/list` and `tools/call`
 * actually put on the wire) and by the tests that pin the tool surface. No MCP
 * client package is a dependency of this app, and none is needed for that.
 */

export interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface Connection {
  init: Record<string, unknown>;
  request: (method: string, params?: Record<string, unknown>) => Promise<RpcReply>;
  close: () => Promise<void>;
}

export async function connectInMemory(ctx: Ctx, options: ToolVisibility = {}): Promise<Connection> {
  const server = buildServer(ctx, options);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (reply: RpcReply) => void>();
  client.onmessage = (message: JSONRPCMessage) => {
    const id = (message as { id?: unknown }).id;
    if (typeof id === 'number' && waiting.has(id)) {
      waiting.get(id)!(message as RpcReply);
      waiting.delete(id);
    }
  };
  await server.connect(serverSide);
  await client.start();

  let nextId = 1;
  const request = (method: string, params?: Record<string, unknown>) =>
    new Promise<RpcReply>((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      void client.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) } as JSONRPCMessage);
    });

  const reply = await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'deckpal-mcp-audit', version: '0.0.0' },
  });
  if (reply.error) throw new Error(`initialize failed: ${reply.error.message}`);
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  return { init: reply.result!, request, close: () => server.close() };
}
