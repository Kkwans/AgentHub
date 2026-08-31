import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { SessionService } from './session-service.js';

const idParams = z.object({ id: z.string().uuid() });
const runParams = z.object({ id: z.string().uuid(), runId: z.string().uuid() });
const listQuery = z.object({ projectId: z.string().uuid().optional() });
const messageQuery = z
  .object({
    beforeSequence: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
const createSchema = z.object({
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  cwd: z.string().min(1).max(4_096),
  branch: z.string().max(1_024).optional(),
  model: z.string().max(160).optional(),
  mode: z.string().max(80).optional(),
  reasoningEffort: z.string().max(80).optional(),
  taskId: z.string().uuid().optional(),
});
const runSchema = z.object({
  text: z.string().min(1).max(1_000_000),
  content: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
  promptVariables: z.record(z.string(), z.unknown()).optional(),
});
const configurationSchema = z
  .object({
    model: z.string().trim().min(1).max(160).optional(),
    mode: z.string().trim().min(1).max(80).optional(),
    reasoningEffort: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine(
    (value) =>
      [value.model, value.mode, value.reasoningEffort].filter((item) => item !== undefined)
        .length === 1,
    {
      message: '一次只能修改一个 Session 配置',
    },
  );

export function createSessionRouter(service: SessionService): Router {
  const router = Router();

  router.get('/', validate({ query: listQuery }), async (request, response, next) => {
    try {
      const { projectId } = listQuery.parse(request.query);
      response.json({ data: await service.list(projectId), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', validate({ body: createSchema }), async (request, response, next) => {
    try {
      response.status(201).json({
        data: await service.create(createSchema.parse(request.body)),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/:id/configuration',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        response.json({ data: await service.getConfiguration(id), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/configuration',
    validate({ params: idParams, body: configurationSchema }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const parsed = configurationSchema.parse(request.body);
        response.json({
          data: await service.updateConfiguration(id, {
            ...(parsed.model !== undefined ? { model: parsed.model } : {}),
            ...(parsed.mode !== undefined ? { mode: parsed.mode } : {}),
            ...(parsed.reasoningEffort !== undefined
              ? { reasoningEffort: parsed.reasoningEffort }
              : {}),
          }),
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

  router.get(
    '/:id/continuation',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        response.json({
          data: await service.getContinuation(id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/continuations',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        response.status(201).json({
          data: await service.continue(id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  for (const action of ['resume', 'close'] as const) {
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

  router.get(
    '/:id/messages',
    validate({ params: idParams, query: messageQuery }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const query = messageQuery.parse(request.query);
        const hasWindow =
          Object.prototype.hasOwnProperty.call(request.query, 'beforeSequence') ||
          Object.prototype.hasOwnProperty.call(request.query, 'limit');
        response.json({
          data: await service.listMessages(id, hasWindow ? query : undefined),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/:id/runs', validate({ params: idParams }), async (request, response, next) => {
    try {
      const { id } = idParams.parse(request.params);
      response.json({ data: await service.listRuns(id), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/:id/runs',
    validate({ params: idParams, body: runSchema }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        response.status(201).json({
          data: await service.startRun(id, runSchema.parse(request.body)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/runs/:runId/cancel',
    validate({ params: runParams }),
    async (request, response, next) => {
      try {
        const { id, runId } = runParams.parse(request.params);
        response.json({ data: await service.cancelRun(id, runId), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

const approvalQuery = z.object({ sessionId: z.string().uuid().optional() });
const approvalParams = z.object({ id: z.string().uuid() });
const decisionSchema = z.object({ optionId: z.string().min(1).max(256) });

export function createApprovalRouter(service: SessionService): Router {
  const router = Router();
  router.get('/', validate({ query: approvalQuery }), async (request, response, next) => {
    try {
      const { sessionId } = approvalQuery.parse(request.query);
      response.json({
        data: await service.listApprovals(sessionId),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', validate({ params: approvalParams }), async (request, response, next) => {
    try {
      const { id } = approvalParams.parse(request.params);
      response.json({
        data: await service.getApproval(id),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/:id/resolve',
    validate({ params: approvalParams, body: decisionSchema }),
    async (request, response, next) => {
      try {
        const { id } = approvalParams.parse(request.params);
        const { optionId } = decisionSchema.parse(request.body);
        response.json({
          data: await service.resolveApproval(id, optionId),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
