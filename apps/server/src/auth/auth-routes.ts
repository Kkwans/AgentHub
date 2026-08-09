import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { AuthService } from './auth-service.js';

const idParams = z.object({ id: z.string().uuid() });
const createToken = z.object({ name: z.string().trim().min(1).max(120) });

export function createAuthRouter(service: AuthService): Router {
  const router = Router();
  router.get('/tokens', async (request, response, next) => {
    try {
      response.json({ data: await service.listTokens(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/tokens', validate({ body: createToken }), async (request, response, next) => {
    try {
      response.status(201).json({
        data: await service.createToken(createToken.parse(request.body).name),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.delete('/tokens/:id', validate({ params: idParams }), async (request, response, next) => {
    try {
      response.json({
        data: await service.revokeToken(idParams.parse(request.params).id),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
