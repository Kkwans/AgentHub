import type { ErrorRequestHandler, RequestHandler } from 'express';
import { InvalidStateTransitionError } from '@agenthub/agent-core';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError(404, 'ROUTE_NOT_FOUND', '请求的接口不存在', {
      method: request.method,
      path: request.path,
    }),
  );
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const requestId = String(request.id);
  const normalized = normalizeError(error);

  if (normalized.status >= 500) {
    request.log.error({ err: error, code: normalized.code }, 'request failed');
  } else {
    request.log.warn({ code: normalized.code }, 'request rejected');
  }

  response.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      requestId,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  });
};

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof InvalidStateTransitionError) {
    return new AppError(409, error.code, error.message, {
      entity: error.entity,
      from: error.from,
      to: error.to,
    });
  }
  if (error instanceof ZodError) {
    return new AppError(400, 'VALIDATION_FAILED', '请求参数不符合要求', {
      issues: error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return new AppError(500, 'INTERNAL_ERROR', '服务器处理请求时发生错误');
}
