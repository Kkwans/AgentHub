import { randomUUID } from 'node:crypto';

import { AGENTHUB_VERSION } from '@agenthub/shared';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pino, { type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';

import { AppError, errorHandler, notFoundHandler } from './errors.js';
import { validate } from './validation.js';
import type { ReplayEventSource } from './websocket.js';
import { createExecutionTargetRouter } from './docker/execution-target-routes.js';
import type { ExecutionTargetService } from './docker/execution-target-service.js';

export interface AppOptions {
  logger?: Logger;
  eventSource?: ReplayEventSource;
  health?: () => Promise<Record<string, unknown>>;
  executionTargets?: ExecutionTargetService;
}

const eventParamsSchema = z.object({ sessionId: z.string().uuid() });
const eventQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const logger = options.logger ?? pino({ level: process.env.LOG_LEVEL ?? 'info' });

  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      genReqId(request, response) {
        const incoming = request.headers['x-request-id'];
        const requestId =
          typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        response.setHeader('x-request-id', requestId);
        return requestId;
      },
      customProps: (request) => ({ requestId: request.id }),
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (request, response, next) => {
    try {
      const details = options.health ? await options.health() : {};
      response.json({
        data: { status: 'ok', version: AGENTHUB_VERSION, ...details },
        requestId: String(request.id),
      });
    } catch (error) {
      next(
        new AppError(503, 'HEALTH_CHECK_FAILED', '服务健康检查未通过', undefined, { cause: error }),
      );
    }
  });

  app.get('/api/v1', (request, response) => {
    response.json({
      data: { name: 'AgentHub', version: AGENTHUB_VERSION, apiVersion: 'v1' },
      requestId: String(request.id),
    });
  });

  if (options.executionTargets) {
    app.use('/api/v1/execution-targets', createExecutionTargetRouter(options.executionTargets));
  }

  app.get(
    '/api/v1/sessions/:sessionId/events',
    validate({ params: eventParamsSchema, query: eventQuerySchema }),
    async (request, response, next) => {
      try {
        if (!options.eventSource)
          throw new AppError(503, 'EVENT_STORE_UNAVAILABLE', '事件存储尚未就绪');
        const { sessionId } = eventParamsSchema.parse(request.params);
        const { afterSeq, limit } = eventQuerySchema.parse(request.query);
        const events = await options.eventSource.listAfter(sessionId, afterSeq, limit);
        response.json({ data: events, requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
