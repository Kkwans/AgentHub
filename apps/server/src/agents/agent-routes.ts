import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { AgentService } from './agent-service.js';
import type { ProjectService } from '../projects/project-service.js';
import { AppError } from '../errors.js';

const idParams = z.object({ id: z.string().uuid() });
const registrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetId: z.string().uuid(),
  agentKind: z.enum(['CODEX', 'CLAUDE_CODE', 'OPENCODE', 'HERMES', 'OPENCLAW', 'CUSTOM_ACP']),
  defaultModel: z.string().trim().min(1).max(160).optional(),
  defaultMode: z.string().trim().min(1).max(80).optional(),
  executable: z.string().trim().min(1).max(1_024).optional(),
  args: z.array(z.string().max(8_192)).max(64).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const preflightSchema = z.object({
  cwd: z.string().min(1).max(4_096),
  smokeSession: z.boolean().optional(),
});
const defaultsSchema = z
  .object({
    defaultModel: z.string().trim().max(160).nullable().optional(),
    defaultMode: z.string().trim().max(80).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个默认设置字段' });

export function createAgentRouter(
  service: AgentService,
  projects?: Pick<ProjectService, 'get'>,
  assertCanLaunch: () => void = () => undefined,
): Router {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      response.json({ data: await service.list(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/catalog', (request, response) => {
    response.json({ data: service.catalog(), requestId: String(request.id) });
  });

  router.get('/diagnostics/host', async (request, response, next) => {
    try {
      response.json({ data: await service.hostDiagnostics(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', validate({ body: registrationSchema }), async (request, response, next) => {
    try {
      const input = registrationSchema.parse(request.body);
      response
        .status(201)
        .json({ data: await service.register(input), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  const connectionCheckSchema = z
    .object({ projectId: z.string().uuid(), expectedTargetId: z.string().uuid() })
    .strict();
  router.post(
    '/:id/connection-check',
    validate({ params: idParams, body: connectionCheckSchema }),
    async (request, response, next) => {
      try {
        if (!projects)
          throw new AppError(503, 'CONNECTION_CHECK_UNAVAILABLE', '项目范围核验暂不可用');
        const input = connectionCheckSchema.parse(request.body);
        const project = await projects.get(input.projectId);
        const report = await service.checkConnection(
          idParams.parse(request.params).id,
          input.expectedTargetId,
          project,
          assertCanLaunch,
        );
        response.json({ data: report, requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:id/preflight',
    validate({ params: idParams, body: preflightSchema }),
    async (request, response, next) => {
      try {
        const { id } = idParams.parse(request.params);
        const input = preflightSchema.parse(request.body);
        response.json({ data: await service.preflight(id, input), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/:id',
    validate({ params: idParams, body: defaultsSchema }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.updateDefaults(
            idParams.parse(request.params).id,
            defaultsSchema.parse(request.body),
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
