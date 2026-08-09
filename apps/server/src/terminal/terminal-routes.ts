import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { TerminalService } from './terminal-service.js';

const idParams = z.object({ id: z.string().uuid() });
const openSchema = z.object({
  projectId: z.string().uuid(),
  path: z.string().max(4_096).optional(),
  shell: z.string().max(4_096).optional(),
  cols: z.number().int().min(10).max(1_000).default(120),
  rows: z.number().int().min(2).max(500).default(32),
});
const inputSchema = z.object({ data: z.string().max(1024 * 1024) });
const resizeSchema = z.object({
  cols: z.number().int().min(10).max(1_000),
  rows: z.number().int().min(2).max(500),
});

export function createTerminalRouter(service: TerminalService): Router {
  const router = Router();
  router.post('/', validate({ body: openSchema }), async (request, response, next) => {
    try {
      const input = openSchema.parse(request.body);
      response.status(201).json({
        data: await service.open({
          projectId: input.projectId,
          cols: input.cols,
          rows: input.rows,
          ...(input.path ? { path: input.path } : {}),
          ...(input.shell ? { shell: input.shell } : {}),
        }),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/:id/input',
    validate({ params: idParams, body: inputSchema }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const { data } = inputSchema.parse(request.body);
        response.json({ data: await service.input(id, data), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/:id/resize',
    validate({ params: idParams, body: resizeSchema }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const { cols, rows } = resizeSchema.parse(request.body);
        response.json({
          data: await service.resize(id, cols, rows),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post('/:id/close', validate({ params: idParams }), async (request, response, next) => {
    try {
      const { id } = idParams.parse(request.params);
      response.json({ data: await service.close(id), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
