import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { ExecutionTargetService } from './execution-target-service.js';

const idParams = z.object({ id: z.string().uuid() });
const mappingSchema = z.object({
  hostRoot: z.string().min(1),
  containerRoot: z.string().min(1),
});
const registrationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(['LOCAL_HOST', 'DOCKER_CONTAINER']),
    hostname: z.string().trim().min(1).max(255),
    os: z.string().trim().min(1).max(80),
    arch: z.string().trim().min(1).max(80),
    containerName: z.string().trim().min(1).max(255).optional(),
    expectedContainerId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    startPolicy: z.enum(['MANUAL', 'ON_DEMAND']).optional(),
    workspaceMappings: z.array(mappingSchema).max(32).optional(),
  })
  .superRefine((input, context) => {
    if (input.kind !== 'DOCKER_CONTAINER') return;
    for (const field of ['containerName', 'expectedContainerId', 'startPolicy'] as const) {
      if (!input[field])
        context.addIssue({ code: 'custom', path: [field], message: 'Docker target 必填' });
    }
  });
const preflightSchema = z.object({ cwd: z.string().optional() }).default({});

export function createExecutionTargetRouter(service: ExecutionTargetService): Router {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      response.json({ data: await service.list(), requestId: String(request.id) });
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
        const { cwd } = preflightSchema.parse(request.body);
        response.json({ data: await service.preflight(id, cwd), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  for (const action of ['start', 'stop'] as const) {
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
