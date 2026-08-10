import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { WorktreeTaskService } from './worktree-task-service.js';

const idParams = z.object({ id: z.string().uuid() });
const taskParams = z.object({ taskId: z.string().uuid() });
const status = z.enum([
  'QUEUED',
  'SETTING_UP',
  'RUNNING',
  'AWAITING_INPUT',
  'REVIEW',
  'MERGING',
  'DONE',
  'BLOCKED',
  'CANCELED',
]);
const listQuery = z.object({
  projectId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  status: status.optional(),
});
const queueBody = z.object({
  agentId: z.string().uuid(),
  baseBranch: z.string().trim().min(1).max(240).optional(),
  model: z.string().trim().min(1).max(160).optional(),
  mode: z.string().trim().min(1).max(80).optional(),
  promptVariables: z.record(z.string(), z.unknown()).optional(),
});
const reworkBody = z.object({ feedback: z.string().trim().min(1).max(1_000_000) });
const mergeBody = z
  .object({ commitMessage: z.string().trim().min(1).max(240).optional() })
  .default({});

export function createWorktreeRouter(service: WorktreeTaskService): Router {
  const router = Router();

  router.get(
    '/worktree-executions',
    validate({ query: listQuery }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.list(listQuery.parse(request.query)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/worktree-executions/:id',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.get(idParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/worktree-executions/:id/review',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.review(idParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/tasks/:taskId/worktree/queue',
    validate({ params: taskParams, body: queueBody }),
    async (request, response, next) => {
      try {
        response.status(202).json({
          data: await service.queueTask(
            taskParams.parse(request.params).taskId,
            queueBody.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/worktree-executions/:id/rework',
    validate({ params: idParams, body: reworkBody }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.rework(
            idParams.parse(request.params).id,
            reworkBody.parse(request.body).feedback,
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/worktree-executions/:id/merge',
    validate({ params: idParams, body: mergeBody }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.merge(
            idParams.parse(request.params).id,
            mergeBody.parse(request.body).commitMessage,
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/worktree-executions/:id/cancel',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.cancel(idParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
