/** A JSON body a fake Provider endpoint can return. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface SeenRequest {
  url: string
  method: string
  authorization: string | null
  body: string
}

export function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** Fakes HTTP below the transport, so the request the tool builds is what the test asserts. */
export function serve(handler: (request: Request) => Response | Promise<Response>) {
  const seen: SeenRequest[] = []
  const original = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    seen.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: await request.clone().text()
    })
    return handler(request)
  }

  return {
    seen,
    restore: () => {
      globalThis.fetch = original
    }
  }
}

/** The single request a deterministic tool call must have made. */
export function onlyRequest(seen: SeenRequest[]): SeenRequest {
  const [request] = seen
  if (!request || seen.length !== 1) throw new Error(`expected one request, saw ${seen.length}`)
  return request
}
