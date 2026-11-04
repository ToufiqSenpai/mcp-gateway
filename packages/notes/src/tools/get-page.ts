import { z } from 'zod';
import { graphClient } from '../client';
import { accountSlug } from '../context';
import { PAGE_SELECT, toPage, type GraphPage } from '../map';
import { defineTool } from './helpers';

export const CONTENT_CAP = 100_000;

/** Cut at the last complete tag boundary at or before the cap. */
export function capContent(html: string, cap = CONTENT_CAP): { content: string; truncated: boolean } {
  if (html.length <= cap) return { content: html, truncated: false };
  const slice = html.slice(0, cap);
  const boundary = slice.lastIndexOf('>');
  return { content: boundary >= 0 ? slice.slice(0, boundary + 1) : '', truncated: true };
}

export const getPageTool = defineTool(
  'get_page',
  {
    title: 'Get page',
    description:
      'Returns one page with its HTML content verbatim. content is capped at 100 000 characters at the last complete tag; contentLength is the full length.',
    inputSchema: z.object({
      account: z.string().optional(),
      pageId: z.string(),
      includeIds: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = graphClient(ctx, slug);
    const id = encodeURIComponent(args.pageId);

    const metadata = await client.request(
      `/me/onenote/pages/${id}?$select=${PAGE_SELECT}&$expand=parentSection`,
    );
    const content = await client.request(
      `/me/onenote/pages/${id}/content${args.includeIds ? '?includeIDs=true' : ''}`,
    );

    const { content: body, truncated } = capContent(content.text);
    return {
      ...toPage(metadata.data as GraphPage),
      content: body,
      contentLength: content.text.length,
      truncated,
    };
  },
);
