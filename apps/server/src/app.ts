import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

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
import { createAgentRouter } from './agents/agent-routes.js';
import type { AgentService } from './agents/agent-service.js';
import { createApprovalRouter, createSessionRouter } from './sessions/session-routes.js';
import type { SessionService } from './sessions/session-service.js';
import { createProjectRouter } from './projects/project-routes.js';
import type { ProjectService } from './projects/project-service.js';
import { createGitRouter } from './git/git-routes.js';
import type { GitService } from './git/git-service.js';
import { createTerminalRouter } from './terminal/terminal-routes.js';
import type { TerminalService } from './terminal/terminal-service.js';
import { createPromptOsRouter } from './promptos/prompt-routes.js';
import type { PromptService } from './promptos/prompt-service.js';
import { createGoalRouter, createTaskRouter } from './tasks/task-routes.js';
import type { TaskService } from './tasks/task-service.js';
import { createDashboardRouter } from './dashboard/dashboard-routes.js';
import type { DashboardSnapshotProvider } from './dashboard/dashboard-service.js';
import { createAuthRouter, createPublicAuthRouter } from './auth/auth-routes.js';
import type { AuthService } from './auth/auth-service.js';
import { createWorktreeRouter } from './worktrees/worktree-routes.js';
import type { WorktreeTaskService } from './worktrees/worktree-task-service.js';
import { createRemoteNodeRouter } from './remote-nodes/remote-node-routes.js';
import type { RemoteNodeService } from './remote-nodes/remote-node-service.js';
import { createDiscoveryRouter } from './discovery/discovery-routes.js';
import type { AgentDiscoveryService } from './discovery/agent-discovery.js';
import type { RuntimeDiscoveryService } from './discovery/runtime-discovery.js';
import { createFilesystemRouter } from './filesystem/filesystem-routes.js';
import type { FilesystemService } from './filesystem/filesystem-service.js';

export interface AppOptions {
  logger?: Logger;
  eventSource?: ReplayEventSource;
  health?: () => Promise<Record<string, unknown>>;
  executionTargets?: ExecutionTargetService;
  agents?: AgentService;
  sessions?: SessionService;
  projects?: ProjectService;
  git?: GitService;
  terminal?: TerminalService;
  promptos?: PromptService;
  tasks?: TaskService;
  dashboard?: DashboardSnapshotProvider;
  auth?: AuthService;
  worktrees?: WorktreeTaskService;
  remoteNodes?: RemoteNodeService;
  runtimeDiscovery?: RuntimeDiscoveryService;
  agentDiscovery?: AgentDiscoveryService;
  filesystem?: FilesystemService;
  webDist?: string;
  secureTransport?: boolean;
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
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Relative assets already inherit the page scheme. This directive breaks the supported
          // HTTP LAN deployment by upgrading its JS/CSS requests to HTTPS.
          upgradeInsecureRequests: null,
        },
      },
      ...(options.secureTransport ? {} : { crossOriginOpenerPolicy: false }),
    }),
  );
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

  if (options.auth) {
    app.use('/api/v1/auth', createPublicAuthRouter(options.auth));
    app.use('/api/v1', options.auth.middleware());
    app.use('/api/v1/auth', createAuthRouter(options.auth));
  }

  app.get('/api/v1', (request, response) => {
    response.json({
      data: { name: 'AgentHub', version: AGENTHUB_VERSION, apiVersion: 'v1' },
      requestId: String(request.id),
    });
  });

  if (options.executionTargets) {
    app.use('/api/v1/execution-targets', createExecutionTargetRouter(options.executionTargets));
  }
  if (options.filesystem) {
    app.use('/api/v1/execution-targets', createFilesystemRouter(options.filesystem));
  }
  if (options.runtimeDiscovery && options.agentDiscovery) {
    app.use(
      '/api/v1/discovery',
      createDiscoveryRouter(options.runtimeDiscovery, options.agentDiscovery),
    );
  }
  if (options.agents) app.use('/api/v1/agents', createAgentRouter(options.agents));
  if (options.sessions) {
    app.use('/api/v1/sessions', createSessionRouter(options.sessions));
    app.use('/api/v1/approvals', createApprovalRouter(options.sessions));
  }
  if (options.projects) app.use('/api/v1/projects', createProjectRouter(options.projects));
  if (options.git) app.use('/api/v1/projects/:id/git', createGitRouter(options.git));
  if (options.terminal) {
    app.use('/api/v1/terminals', createTerminalRouter(options.terminal));
    app.get('/api/v1/settings/capabilities', async (request, response, next) => {
      try {
        response.json({
          data: {
            terminal: await options.terminal!.diagnose(),
            remoteNode: {
              available: Boolean(options.remoteNodes),
              transport: options.remoteNodes ? 'outbound_websocket' : undefined,
            },
          },
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    });
  }
  if (options.promptos) app.use('/api/v1', createPromptOsRouter(options.promptos));
  if (options.tasks) {
    app.use('/api/v1/goals', createGoalRouter(options.tasks));
    app.use('/api/v1/tasks', createTaskRouter(options.tasks));
  }
  if (options.worktrees) app.use('/api/v1', createWorktreeRouter(options.worktrees));
  if (options.remoteNodes)
    app.use('/api/v1/remote-nodes', createRemoteNodeRouter(options.remoteNodes));
  if (options.dashboard) app.use('/api/v1/dashboard', createDashboardRouter(options.dashboard));

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

  if (options.webDist) {
    app.use(express.static(options.webDist, { index: false, fallthrough: true }));
    app.use((request, response, next) => {
      if (
        request.method !== 'GET' ||
        request.path.startsWith('/api/') ||
        request.path === '/ws' ||
        !request.accepts('html')
      ) {
        next();
        return;
      }
      response.sendFile(join(options.webDist!, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
