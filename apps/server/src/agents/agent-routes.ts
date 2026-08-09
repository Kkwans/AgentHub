import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { AgentService } from './agent-service.js';

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

export function createAgentRouter(service: AgentService): Router {
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

  return router;
}
