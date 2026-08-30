import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { ProjectService } from './project-service.js';

const idParams = z.object({ id: z.string().uuid() });
const addSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(4_000).optional(),
  targetId: z.string().uuid(),
  rootPath: z.string().min(1).max(4_096),
  kind: z.enum(['STANDARD', 'TEST']).default('STANDARD'),
});
const preflightPathSchema = z.object({ rootPath: z.string().min(1).max(4_096) });
const preflightTargetSchema = z.object({
  targetId: z.string().uuid(),
  rootPath: z.string().min(1).max(4_096),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().max(4_000).nullable().optional(),
    kind: z.enum(['STANDARD', 'TEST']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个修改字段' });
const treeQuery = z.object({
  path: z.string().max(4_096).default(''),
  depth: z.coerce.number().int().min(0).max(6).default(2),
});
const contentQuery = z.object({ path: z.string().min(1).max(4_096) });

export function createProjectRouter(service: ProjectService): Router {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      response.json({ data: await service.list(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', validate({ body: addSchema }), async (request, response, next) => {
    try {
      response.status(201).json({
        data: await service.add(addSchema.parse(request.body)),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/preflight',
    validate({ body: preflightTargetSchema }),
    async (request, response, next) => {
      try {
        const input = preflightTargetSchema.parse(request.body);
        response.json({
          data: await service.preflightForTarget(input.targetId, input.rootPath),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/preflight-path',
    validate({ body: preflightPathSchema }),
    async (request, response, next) => {
      try {
        const { rootPath } = preflightPathSchema.parse(request.body);
        response.json({
          data: await service.preflightPath(rootPath),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id/files/content',
    validate({ params: idParams, query: contentQuery }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const { path } = contentQuery.parse(request.query);
        response.json({ data: await service.readFile(id, path), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id/files',
    validate({ params: idParams, query: treeQuery }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const { path, depth } = treeQuery.parse(request.query);
        response.json({
          data: await service.listFiles(id, path, depth),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/:id', validate({ params: idParams }), async (request, response, next) => {
    try {
      const { id } = idParams.parse(request.params);
      response.json({ data: await service.get(id), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/:id',
    validate({ params: idParams, body: updateSchema }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const input = updateSchema.parse(request.body);
        response.json({
          data: await service.update(id, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.kind !== undefined ? { kind: input.kind } : {}),
          }),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  for (const action of ['preflight', 'archive'] as const) {
    router.post(
      `/:id/${action}`,
      validate({ params: idParams }),
      async (request, response, next) => {
        try {
          const { id } = idParams.parse(request.params);
          response.json({ data: await service[action](id), requestId: String(request.id) });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  return router;
}
