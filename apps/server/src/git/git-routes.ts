import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { GitService } from './git-service.js';

const projectParams = z.object({ id: z.string().uuid() });
const diffQuery = z.object({
  staged: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  path: z.string().max(4_096).optional(),
  whitespace: z
    .enum(['default', 'ignore-all-space', 'ignore-space-change', 'ignore-blank-lines'])
    .default('default'),
});
const commitsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const commitSchema = z
  .object({
    message: z.string().trim().min(1).max(10_000),
    mode: z.enum(['STAGED', 'SELECTED']),
    paths: z.array(z.string().min(1).max(4_096)).max(500).optional(),
  })
  .superRefine((input, context) => {
    if (input.mode === 'SELECTED' && !input.paths?.length) {
      context.addIssue({ code: 'custom', path: ['paths'], message: '必须选择文件' });
    }
  });

export function createGitRouter(service: GitService): Router {
  const router = Router({ mergeParams: true });

  router.get('/status', validate({ params: projectParams }), async (request, response, next) => {
    try {
      const { id } = projectParams.parse(request.params);
      response.json({ data: await service.status(id), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/diff',
    validate({ params: projectParams, query: diffQuery }),
    async (request, response, next) => {
      try {
        const { id } = projectParams.parse(request.params);
        const input = diffQuery.parse(request.query);
        response.json({
          data: await service.diff(id, {
            staged: input.staged,
            ...(input.path ? { path: input.path } : {}),
            whitespace: input.whitespace,
          }),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/commits',
    validate({ params: projectParams, query: commitsQuery }),
    async (request, response, next) => {
      try {
        const { id } = projectParams.parse(request.params);
        const { limit } = commitsQuery.parse(request.query);
        response.json({ data: await service.commits(id, limit), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/branches', validate({ params: projectParams }), async (request, response, next) => {
    try {
      const { id } = projectParams.parse(request.params);
      response.json({ data: await service.branches(id), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/commit',
    validate({ params: projectParams, body: commitSchema }),
    async (request, response, next) => {
      try {
        const { id } = projectParams.parse(request.params);
        const input = commitSchema.parse(request.body);
        response.status(201).json({
          data: await service.commit(id, {
            message: input.message,
            mode: input.mode,
            ...(input.paths ? { paths: input.paths } : {}),
          }),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
