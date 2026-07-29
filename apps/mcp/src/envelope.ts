import type { CallToolResult } from '@modelcontextprotocol/server';

/**
 * The house tool-result envelope (SPEC §4). Every tool handler wraps its body
 * in try/catch and returns one of these two shapes — never throws to the
 * transport.
 */

export function ok(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
