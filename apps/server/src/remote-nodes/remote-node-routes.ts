import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { RemoteNodeService } from './remote-node-service.js';

const idParams = z.object({ id: z.string().uuid() });
const registrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  allowedRoots: z.array(z.string().min(1).max(4_096)).min(1).max(32),
  expiresInMinutes: z.number().int().min(1).max(1_440).optional(),
});

export function createRemoteNodeRouter(service: RemoteNodeService): Router {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      response.json({ data: await service.list(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/registration-tokens',
    validate({ body: registrationSchema }),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.createRegistrationToken(registrationSchema.parse(request.body)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/:id/diagnostics',
    validate({ params: idParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.diagnostics(idParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post('/:id/revoke', validate({ params: idParams }), async (request, response, next) => {
    try {
      response.json({
        data: await service.revoke(idParams.parse(request.params).id),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
