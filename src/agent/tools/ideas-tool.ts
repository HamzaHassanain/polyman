/**
 * The `find_ideas` tool: the chat agent hands a topic to the idea workflow
 * and gets ranked, checked problem ideas back. It works before there is a
 * problem folder, and it only calls the model, so it asks nothing.
 */

import {
  ideasReport,
  type IdeaRequest,
  type IdeasResult,
} from '../workflow/ideas';
import type { Tool, ToolOutput } from './types';

/** Time limit of one idea run. */
export const IDEAS_TIMEOUT_MS = 5 * 60 * 1000;

/** What the model is told after the ideas are found. */
export const AFTER_IDEAS =
  'Show the ideas to the user, best first: for each one its number, title, the task in 1 or 2 lines, and its review line. Plain text, no LaTeX, no $ signs. Do not invent other ideas. Ask which one to take, or what to change. When the user picks one, go to the Think step with that idea.';

/** What the tool runs. `IdeaWorkflow` in the real chat. */
export interface IdeasRunner {
  run(request: IdeaRequest, signal: AbortSignal): Promise<IdeasResult>;
}

/** The arguments of `find_ideas`. */
export interface FindIdeasArgs {
  topic: string;
  rating?: number;
  wish?: string;
  avoid?: string[];
}

/** The `find_ideas` tool. */
export function ideasTool(opts: {
  createRunner(): IdeasRunner;
}): Tool<FindIdeasArgs> {
  return {
    name: 'find_ideas',
    description:
      'Find new problem ideas with the idea workflow: 3 ideas in parallel from different angles, a check of each complexity against its constraints, a critic review of each (clarity, rating, known or fresh), then a ranking. Use it whenever the user asks for problem ideas, or for other or more novel ones. Never invent ideas yourself.',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'The topic or technique, like "two pointers".',
        },
        rating: {
          type: 'integer',
          description:
            'The Codeforces rating the user wants, like 1600. Leave it out when the user did not say.',
        },
        wish: {
          type: 'string',
          description:
            'What the user wants, in their words, like "more novel" or "on trees".',
        },
        avoid: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Titles of ideas already shown, when the user wants other ones.',
        },
      },
      required: ['topic'],
      additionalProperties: false,
    },
    risk: 'read',
    needsProblem: false,
    timeoutMs: IDEAS_TIMEOUT_MS,
    describe: args => ({ title: `Find ideas about ${args.topic}` }),
    async run(args, ctx): Promise<ToolOutput> {
      const request: IdeaRequest = { topic: String(args.topic ?? '').trim() };
      if (request.topic === '') {
        return {
          content: 'topic is empty: say what the ideas are about.',
          isError: true,
        };
      }
      if (typeof args.rating === 'number') request.rating = args.rating;
      if (typeof args.wish === 'string' && args.wish.trim() !== '') {
        request.wish = args.wish.trim();
      }
      if (Array.isArray(args.avoid) && args.avoid.length > 0) {
        request.avoid = args.avoid.filter(a => typeof a === 'string');
      }
      const result = await opts.createRunner().run(request, ctx.signal);
      return {
        content: [
          result.summary,
          '',
          ideasReport(result),
          '',
          AFTER_IDEAS,
        ].join('\n'),
        ...(result.ok ? {} : { isError: true }),
        data: result.ideas,
      };
    },
  };
}
