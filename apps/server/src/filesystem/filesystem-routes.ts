import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { FilesystemService } from './filesystem-service.js';

const targetParams = z.object({ id: z.string().uuid() });
const directoryQuery = z.object({
  root: z.string().max(4_096).optional(),
  path: z.string().max(4_096).default(''),
});
const candidateQuery = z.object({ root: z.string().max(4_096).optional() });

export function createFilesystemRouter(service: FilesystemService): Router {
  const router = Router();
  router.get(
    '/:id/filesystem/roots',
    validate({ params: targetParams }),
    async (request, response, next) => {
      try {
        const { id } = targetParams.parse(request.params);
        response.json({ data: await service.listRoots(id), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/:id/filesystem/directories',
    validate({ params: targetParams, query: directoryQuery }),
    async (request, response, next) => {
      try {
        const { id } = targetParams.parse(request.params);
        const { root, path } = directoryQuery.parse(request.query);
        response.json({
          data: await service.listDirectories(id, root, path),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/:id/project-candidates',
    validate({ params: targetParams, query: candidateQuery }),
    async (request, response, next) => {
      try {
        const { id } = targetParams.parse(request.params);
        const { root } = candidateQuery.parse(request.query);
        response.json({
          data: await service.discoverProjects(id, root),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
