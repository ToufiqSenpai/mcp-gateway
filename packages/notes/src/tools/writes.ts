import { z } from 'zod';
import { graphClient } from '../client';
import { accountSlug } from '../context';
import {
  NOTEBOOK_SELECT,
  SECTION_SELECT,
  toNotebook,
  toSection,
  type GraphNotebook,
  type GraphSection,
} from '../map';
import { defineTool } from './helpers';

export const deletePageTool = defineTool(
  'delete_page',
  {
    title: 'Delete page',
    description: 'Deletes a page. Graph exposes no undo or trash step.',
    inputSchema: z.object({ account: z.string().optional(), pageId: z.string() }),
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    await graphClient(ctx, slug).request(
      `/me/onenote/pages/${encodeURIComponent(args.pageId)}`,
      { method: 'DELETE' },
    );
    return { pageId: args.pageId, deleted: true };
  },
);

export const createSectionTool = defineTool(
  'create_section',
  {
    title: 'Create section',
    description:
      'Creates a section. Exactly one parent is required: notebookId or sectionGroupId.',
    inputSchema: z.object({
      account: z.string().optional(),
      displayName: z.string().min(1),
      notebookId: z.string().optional(),
      sectionGroupId: z.string().optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async (args, ctx) => {
    const hasNotebook = Boolean(args.notebookId);
    const hasGroup = Boolean(args.sectionGroupId);
    if (hasNotebook === hasGroup) {
      throw new Error('Pass exactly one of notebookId or sectionGroupId.');
    }

    const slug = await accountSlug(ctx, args.account);
    const client = graphClient(ctx, slug);
    const path = args.notebookId
      ? `/me/onenote/notebooks/${encodeURIComponent(args.notebookId)}/sections`
      : `/me/onenote/sectionGroups/${encodeURIComponent(args.sectionGroupId as string)}/sections`;

    const response = await client.request(path, {
      method: 'POST',
      body: JSON.stringify({ displayName: args.displayName }),
      contentType: 'application/json',
    });

    const created = response.data as GraphSection;
    if ((created.parentNotebook?.id || created.parentSectionGroup?.id) || !created.id) {
      return toSection(created);
    }

    const followUp = await client.request(
      `/me/onenote/sections/${encodeURIComponent(created.id)}?$select=${SECTION_SELECT}&$expand=parentNotebook,parentSectionGroup`,
    );
    return toSection(followUp.data as GraphSection);
  },
);

export const createNotebookTool = defineTool(
  'create_notebook',
  {
    title: 'Create notebook',
    description:
      'Creates a notebook. This changes the container list, so the enumeration cache is invalidated.',
    inputSchema: z.object({ account: z.string().optional(), displayName: z.string().min(1) }),
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async (args, ctx) => {
    const slug = await accountSlug(ctx, args.account);
    const response = await graphClient(ctx, slug).request('/me/onenote/notebooks', {
      method: 'POST',
      body: JSON.stringify({ displayName: args.displayName }),
      contentType: 'application/json',
    });

    await ctx.invalidateEnumeration();

    const created = response.data as GraphNotebook;
    if (created.id && !created.links) {
      const followUp = await graphClient(ctx, slug).request(
        `/me/onenote/notebooks/${encodeURIComponent(created.id)}?$select=${NOTEBOOK_SELECT}`,
      );
      return toNotebook(followUp.data as GraphNotebook);
    }
    return toNotebook(created);
  },
);
