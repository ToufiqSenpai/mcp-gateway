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

export interface RequestOptions {
  slug?: string
  headers?: Record<string, string>
}

/** Reads a reply field as the shape the test is about to assert. */
export function asReply<T>(value: JsonValue | undefined): T {
  // SAFETY: each caller asserts the documented reply shape for the request it sent.
  return value as T
}

export const stubContext: McpContext = {
  listAccounts() {
    return Promise.resolve([{ slug: "personal", isDefault: true }])
  },
  getAccessToken() {
    return Promise.resolve("test-access-token")
  },
  refreshAccessToken() {
    return Promise.resolve("test-access-token")
  },
  cursors: {
    accountSet() {
      return Promise.resolve("test-set")
    },
    encode() {
      return Promise.resolve("next-cursor")
    },
    decode() {
      return Promise.resolve({ o: 0, a: "test-set" })
    }
  },
  async invalidateEnumeration() {},
  async enumeration<T>(_account: string, load: () => Promise<{ items: T[]; truncated: boolean }>) {
    return load()
  }
}

export function modernRequest(body: JsonRpcCall, options: RequestOptions = {}): Request {
  const params = body.params ?? {}
  const name = params.name
  const requestHeaders = new Headers({
    "content-type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "Mcp-Method": body.method
  })
  if (name) requestHeaders.set("Mcp-Name", name)
  for (const [key, value] of Object.entries(options.headers ?? {})) requestHeaders.set(key, value)

  return new Request(`http://localhost/mcps/${options.slug ?? "calendar"}`, {
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

export async function call(server: McpServer, body: JsonRpcCall, options: RequestOptions = {}): Promise<JsonRpcReply> {
  const handler = createMcpHandler(() => server, { legacy: "reject", responseMode: "json" })
  const response = await handler.fetch(modernRequest(body, options))
  // SAFETY: the JSON-RPC handler answers with a JSON-RPC reply envelope.
  return (await response.json()) as JsonRpcReply
}

export interface McpHelpers {
  modernRequest: (body: JsonRpcCall, headers?: Record<string, string>) => Request
  call: (server: McpServer, body: JsonRpcCall) => Promise<JsonRpcReply>
}

/** Binds the harness to one MCP slug, so a package's test support is a couple of lines. */
export function bindMcp(slug: string): McpHelpers {
  return {
    modernRequest: (body, headers = {}) => modernRequest(body, { slug, headers }),
    call: (server, body) => call(server, body, { slug })
  }
}
