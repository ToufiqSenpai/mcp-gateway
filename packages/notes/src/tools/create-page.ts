import { z } from 'zod';
import { graphClient } from '../client';
import { accountSlug } from '../context';
import { PAGE_SELECT, toPage, type GraphPage } from '../map';
import { defineTool } from './helpers';

export const MAX_DOCUMENT_BYTES = 4_194_304;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function wrapDocument(title: string, content: string): string {
  return `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head><body>${content}</body></html>`;
}

export function assertDocumentSize(document: string): void {
  const bytes = new TextEncoder().encode(document).length;
  if (bytes > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `The wrapped document is ${bytes} bytes; the maximum is ${MAX_DOCUMENT_BYTES} (data.maxBytes: ${MAX_DOCUMENT_BYTES}).`,
    );
  }
}

export const createPageTool = defineTool(
  'create_page',
  {
    title: 'Create page',
    description:
      'Creates a page from an HTML fragment, wrapped in a full document. Over 4 MiB is refused with data.maxBytes 4194304.',
    inputSchema: z.object({
      account: z.string().optional(),
      sectionId: z.string(),
      title: z.string(),
      content: z.string(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const client = graphClient(ctx, slug);
    const document = wrapDocument(args.title, args.content);
    assertDocumentSize(document);

    const response = await client.request(
      `/me/onenote/sections/${encodeURIComponent(args.sectionId)}/pages`,
      { method: 'POST', body: document, contentType: 'text/html; charset=utf-8' },
    );

    const created = response.data as GraphPage;
    if (created.parentSection?.id || !created.id) return toPage(created);

    // Graph omits the parent on some responses; normalise with one follow-up read.
    const followUp = await client.request(
      `/me/onenote/pages/${encodeURIComponent(created.id)}?$select=${PAGE_SELECT}&$expand=parentSection`,
    );
    return toPage(followUp.data as GraphPage);
  },
);
