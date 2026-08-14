import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { AgentDiscoveryService } from './agent-discovery.js';
import type { RuntimeDiscoveryService } from './runtime-discovery.js';

const candidateParams = z.object({ candidateId: z.string().min(1).max(240) });

export function createDiscoveryRouter(
  runtimes: RuntimeDiscoveryService,
  agents: AgentDiscoveryService,
): Router {
  const router = Router();

  router.get('/agents', async (request, response, next) => {
    try {
      response.json({ data: await agents.list(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/agents/rescan', async (request, response, next) => {
    try {
      response.json({ data: await agents.rescan(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/agents/:candidateId/adopt',
    validate({ params: candidateParams }),
    async (request, response, next) => {
      try {
        const { candidateId } = candidateParams.parse(request.params);
        response
          .status(201)
          .json({ data: await agents.adopt(candidateId), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/runtimes', async (request, response, next) => {
    try {
      response.json({ data: await runtimes.list(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/runtimes/rescan', async (request, response, next) => {
    try {
      response.json({ data: await runtimes.rescan(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/runtimes/:candidateId/adopt',
    validate({ params: candidateParams }),
    async (request, response, next) => {
      try {
        const { candidateId } = candidateParams.parse(request.params);
        response
          .status(201)
          .json({ data: await runtimes.adopt(candidateId), requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
