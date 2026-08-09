import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { TaskService } from './task-service.js';

const idParams = z.object({ id: z.string().uuid() });
const goalListQuery = z.object({ projectId: z.string().uuid().optional() });
const goalCreate = z.object({
  projectId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(20_000).optional(),
  successCriteria: z.string().max(20_000).optional(),
});
const goalUpdate = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(20_000).nullable().optional(),
    successCriteria: z.string().max(20_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个修改字段' });
const goalTransition = z.object({ status: z.enum(['ACTIVE', 'ACHIEVED', 'CANCELED']) });

const taskStatus = z.enum([
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'WAITING_REVIEW',
  'DONE',
  'BLOCKED',
  'CANCELED',
]);
const taskListQuery = z.object({
  projectId: z.string().uuid().optional(),
  goalId: z.string().uuid().optional(),
  status: taskStatus.optional(),
});
const taskCreate = z.object({
  projectId: z.string().uuid(),
  goalId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(100_000).optional(),
  acceptanceCriteria: z.string().max(100_000).optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  branch: z.string().max(1_024).optional(),
  position: z
    .string()
    .regex(/^-?\d+(\.\d{1,8})?$/)
    .optional(),
});
const taskUpdate = z
  .object({
    goalId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(100_000).nullable().optional(),
    acceptanceCriteria: z.string().max(100_000).nullable().optional(),
    priority: z.number().int().min(-100).max(100).optional(),
    branch: z.string().max(1_024).nullable().optional(),
    position: z
      .string()
      .regex(/^-?\d+(\.\d{1,8})?$/)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个修改字段' });
const taskTransition = z.object({ status: taskStatus });
const taskStart = z.object({
  agentId: z.string().uuid(),
  model: z.string().max(160).optional(),
  mode: z.string().max(80).optional(),
  promptVariables: z.record(z.string(), z.unknown()).optional(),
});
const taskReview = z.object({ decision: z.enum(['APPROVE', 'REWORK']) });

export function createGoalRouter(service: TaskService): Router {
  const router = Router();
  router.get('/', validate({ query: goalListQuery }), async (request, response, next) => {
    try {
      const { projectId } = goalListQuery.parse(request.query);
      response.json({ data: await service.listGoals(projectId), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/', validate({ body: goalCreate }), async (request, response, next) => {
    try {
      response.status(201).json({
        data: await service.createGoal(goalCreate.parse(request.body)),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', validate({ params: idParams }), async (request, response, next) => {
    try {
      response.json({
        data: await service.getGoal(idParams.parse(request.params).id),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch(
    '/:id',
    validate({ params: idParams, body: goalUpdate }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.updateGoal(
            idParams.parse(request.params).id,
            goalUpdate.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/:id/transition',
    validate({ params: idParams, body: goalTransition }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.transitionGoal(
            idParams.parse(request.params).id,
            goalTransition.parse(request.body).status,
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

export function createTaskRouter(service: TaskService): Router {
  const router = Router();
  router.get('/', validate({ query: taskListQuery }), async (request, response, next) => {
    try {
      response.json({
        data: await service.listTasks(taskListQuery.parse(request.query)),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post('/', validate({ body: taskCreate }), async (request, response, next) => {
    try {
      response.status(201).json({
        data: await service.createTask(taskCreate.parse(request.body)),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', validate({ params: idParams }), async (request, response, next) => {
    try {
      response.json({
        data: await service.getTask(idParams.parse(request.params).id),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.patch(
    '/:id',
    validate({ params: idParams, body: taskUpdate }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.updateTask(
            idParams.parse(request.params).id,
            taskUpdate.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/:id/transition',
    validate({ params: idParams, body: taskTransition }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.transitionTask(
            idParams.parse(request.params).id,
            taskTransition.parse(request.body).status,
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/:id/start',
    validate({ params: idParams, body: taskStart }),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.startTask(
            idParams.parse(request.params).id,
            taskStart.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/:id/review',
    validate({ params: idParams, body: taskReview }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.reviewTask(
            idParams.parse(request.params).id,
            taskReview.parse(request.body).decision,
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
