import type { McpContext } from "@mcp-gateway/common"
import { createMcpHandler, CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server"
import type { McpServer } from "@modelcontextprotocol/server"

export const PROTOCOL_VERSION = "2026-07-28"

/** A JSON value as it crosses the wire in a test request or reply. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonRpcResult = Record<string, JsonValue>

export interface JsonRpcParameters {
  name?: string
  arguments?: JsonValue
}

export interface JsonRpcCall {
  method: string
  params?: JsonRpcParameters
}

export interface JsonRpcError {
  code: number
  message: string
  data?: JsonValue
}

export interface JsonRpcReply {
  result?: JsonRpcResult
  error?: JsonRpcError
}

/** Reads a reply field as the shape the test is about to assert. */
export function asReply<T>(value: JsonValue | undefined): T {
  // SAFETY: each caller asserts the documented reply shape for the request it sent.
  return value as T
}

export const stubContext: McpContext = {
  async listAccounts() {
    return [{ slug: "personal", isDefault: true }]
  },
  async getAccessToken() {
    return "test-access-token"
  },
  async refreshAccessToken() {
    return "test-access-token"
  },
  cursors: {
    async accountSet() {
      return "test-set"
    },
    async encode() {
      return "next-cursor"
    },
    async decode() {
      return { o: 0, a: "test-set" }
    }
  },
  async invalidateEnumeration() {},
  async enumeration<T>(_account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
    return load()
  }
}

export function modernRequest(body: JsonRpcCall): Request {
  const params = body.params ?? {}
  const name = params.name
  const requestHeaders = new Headers({
    "content-type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "Mcp-Method": body.method
  })
  if (name) requestHeaders.set("Mcp-Name", name)

  return new Request("http://localhost/mcps/notes", {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      ...body,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {}
        }
      }
    })
  })
}

export async function call(server: McpServer, body: JsonRpcCall): Promise<JsonRpcReply> {
  const handler = createMcpHandler(() => server, { legacy: "reject", responseMode: "json" })
  const response = await handler.fetch(modernRequest(body))
  // SAFETY: the JSON-RPC handler answers with a JSON-RPC reply envelope.
  return (await response.json()) as JsonRpcReply
}
