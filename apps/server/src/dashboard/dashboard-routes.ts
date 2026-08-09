import { Router } from 'express';

import type { DashboardSnapshotProvider } from './dashboard-service.js';

export function createDashboardRouter(service: DashboardSnapshotProvider): Router {
  const router = Router();
  router.get('/', async (request, response, next) => {
    try {
      response.json({ data: await service.snapshot(), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
