import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface ValidationSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (request, _response, next) => {
    try {
      if (schemas.params) schemas.params.parse(request.params);
      if (schemas.query) schemas.query.parse(request.query);
      if (schemas.body) request.body = schemas.body.parse(request.body) as unknown;
      next();
    } catch (error) {
      next(error);
    }
  };
}
