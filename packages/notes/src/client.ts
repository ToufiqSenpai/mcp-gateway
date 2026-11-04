import type { McpContext } from './context';

export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

/**
 * Graph is called over plain `fetch` — the documented fallback when the kiota preview chain
 * cannot be relied on. The seam is the base URL, so tests fake HTTP exactly where production
 * calls it; no SDK method is stubbed.
 */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GraphResponse {
  status: number;
  data: unknown;
  text: string;
}

interface ErrorBody {
  error?: { code?: string | number; message?: string; innerError?: unknown };
}

function parseError(text: string): { code: string; message: string } {
  try {
    const body = JSON.parse(text) as ErrorBody;
    return {
      code: String(body.error?.code ?? 'unknown'),
      message: body.error?.message ?? 'Graph request failed',
    };
  } catch {
    return { code: 'unknown', message: 'Graph request failed' };
  }
}

export class GraphClient {
  constructor(
    private readonly ctx: McpContext,
    private readonly slug: string,
    private readonly baseUrl: string = GRAPH_BASE_URL,
  ) {}

  async request(
    path: string,
    init: { method?: string; body?: string; contentType?: string } = {},
  ): Promise<GraphResponse> {
    const send = async (token: string): Promise<Response> => {
      const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
      return fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(init.contentType ? { 'Content-Type': init.contentType } : {}),
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
    };

    const token = await this.ctx.getAccessToken(this.slug);
    let response = await send(token);
    if (response.status === 401) {
      // Reactive refresh: one forced rotation and one retry.
      response = await send(await this.ctx.refreshAccessToken(this.slug));
    }

    const text = response.status === 204 ? '' : await response.text();
    if (!response.ok) {
      const { code, message } = parseError(text);
      throw new GraphError(response.status, code, message);
    }

    return {
      status: response.status,
      text,
      data: text ? (JSON.parse(text) as unknown) : undefined,
    };
  }

  /** Follows `@odata.nextLink` to the cap; next links never reach the client. */
  async collect<T>(
    path: string,
    cap = 1000,
  ): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let next: string | undefined = path;

    while (next && items.length < cap) {
      const response: GraphResponse = await this.request(next);
      const page = (response.data ?? {}) as { value?: T[]; '@odata.nextLink'?: string };
      items.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
    }

    return { items: items.slice(0, cap), truncated: items.length >= cap };
  }
}

export function graphClient(
  ctx: McpContext,
  slug: string,
  baseUrl?: string,
): GraphClient {
  return new GraphClient(ctx, slug, baseUrl);
}
