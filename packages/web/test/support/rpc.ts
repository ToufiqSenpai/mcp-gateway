import { CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY } from "@modelcontextprotocol/server"
import { z } from "zod"

import { TEST_ORIGIN, appFetch, mcpJwt } from "./access"

export const PROTOCOL_VERSION = "2026-07-28"

const JsonValue = z.json()

/** A JSON-RPC body as a test writes it: a method plus the tool name and arguments it carries. */
const RpcRequest = z.object({
  method: z.string(),
  params: z.object({ name: z.string().optional(), uri: z.string().optional() }).catchall(JsonValue).optional()
})

export type RpcRequest = z.infer<typeof RpcRequest>

/** Only what a conformance test reads: a result, an error code, or neither. */
const RpcReply = z.object({
  result: JsonValue.optional(),
  error: z.object({ code: z.number() }).loose().optional()
})

export type RpcReply = z.infer<typeof RpcReply>

export interface RpcResponse {
  status: number
  headers: Headers
  reply: RpcReply
}

/** A 404 or 403 carries no JSON-RPC envelope, so an unparseable body is an empty reply. */
function parseReply(text: string): RpcReply {
  try {
    const parsed = RpcReply.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/** Sends one JSON-RPC exchange to a deployed Worker and parses the envelope. */
export async function rpc(
  body: RpcRequest,
  options: { slug?: string; token?: string; origin?: string } = {}
): Promise<RpcResponse> {
  const token = options.token ?? (await mcpJwt())
  const headers = new Headers({
    "content-type": "application/json",
    "Cf-Access-Jwt-Assertion": token,
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "Mcp-Method": body.method
  })
  const headerName = body.params?.name ?? body.params?.uri
  if (headerName) headers.set("Mcp-Name", headerName)

  const response = await appFetch(`${options.origin ?? TEST_ORIGIN}/mcps/${options.slug ?? "calendar"}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      ...body,
      params: {
        ...body.params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {}
        }
      }
    })
  })

  return {
    status: response.status,
    headers: response.headers,
    reply: parseReply(await response.text())
  }
}

/** `server/discover` reply, including the per-server `_meta` block. */
export const DiscoveryResult = z
  .object({
    resultType: z.string(),
    supportedVersions: z.array(z.string()).optional(),
    capabilities: z.record(z.string(), JsonValue),
    _meta: z.record(z.string(), z.record(z.string(), JsonValue))
  })
  .loose()

export const ToolListResult = z
  .object({
    resultType: z.string().optional(),
    tools: z.array(z.object({ name: z.string() }).loose())
  })
  .loose()

export const ToolCallResult = z
  .object({
    resultType: z.string().optional(),
    isError: z.boolean().optional(),
    content: z.array(z.object({ text: z.string().optional() }).loose()).optional()
  })
  .loose()

export const ResourcesResult = z.object({ resources: z.array(JsonValue) }).loose()

export const TemplatesResult = z.object({ resourceTemplates: z.array(JsonValue) }).loose()
