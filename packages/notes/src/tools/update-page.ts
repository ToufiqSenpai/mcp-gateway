import { z } from 'zod';
import { graphClient } from '../client';
import { accountSlug } from '../context';
import { defineTool } from './helpers';

const commandSchema = z.object({
  target: z.string().min(1).describe('#<data-id>, body, or title'),
  action: z.enum(['replace', 'append', 'prepend', 'insert', 'delete']),
  content: z.string().optional(),
  position: z.enum(['after', 'before']).optional(),
});

type Command = z.infer<typeof commandSchema>;

export function validateCommands(commands: Command[]): void {
  if (commands.length === 0) throw new Error('commands must contain at least one command.');

  for (const command of commands) {
    if (command.action !== 'delete' && command.content === undefined) {
      throw new Error(`A "${command.action}" command requires content.`);
    }
    if (command.position !== undefined && command.action !== 'append' && command.action !== 'insert') {
      throw new Error('position is only accepted with append or insert.');
    }
  }
}

export const updatePageTool = defineTool(
  'update_page',
  {
    title: 'Update page',
    description:
      'Forwards Graph patchContentCommand objects unchanged. There is no whole-page replace: target body supports append only, and replace needs a generated element id (except target "title").',
    inputSchema: z.object({
      account: z.string().optional(),
      pageId: z.string(),
      commands: z.array(commandSchema).min(1),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async (args, ctx) => {
    validateCommands(args.commands);
    const slug = await accountSlug(ctx, args.account);

    await graphClient(ctx, slug).request(
      `/me/onenote/pages/${encodeURIComponent(args.pageId)}/content`,
      {
        method: 'PATCH',
        body: JSON.stringify(args.commands),
        contentType: 'application/json',
      },
    );

    return { pageId: args.pageId, updated: true };
  },
);
