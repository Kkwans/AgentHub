import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import { browserSessionCookie, type AuthPrincipal, type AuthService } from './auth-service.js';

const idParams = z.object({ id: z.string().uuid() });
const username = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[\p{L}\p{N}._-]+$/u, '用户名只能包含文字、数字、点、下划线或连字符');
const password = z.string().min(6).max(128);
const credentials = z.object({ username, password });
const passwordChange = z.object({ currentPassword: password, newPassword: password });
const createToken = z.object({ name: z.string().trim().min(1).max(120) });

export function createPublicAuthRouter(service: AuthService): Router {
  const router = Router();
  router.get('/status', async (request, response, next) => {
    try {
      response.json({ data: await service.status(request.headers), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/setup', validate({ body: credentials }), async (request, response, next) => {
    try {
      const input = credentials.parse(request.body);
      const session = await service.setup(input.username, input.password);
      response.cookie(browserSessionCookie, session.token, service.cookieOptions());
      response.status(201).json({ data: { user: session.user }, requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/login', validate({ body: credentials }), async (request, response, next) => {
    try {
      const input = credentials.parse(request.body);
      const session = await service.login(input.username, input.password, request.ip ?? 'unknown');
      response.cookie(browserSessionCookie, session.token, service.cookieOptions());
      response.json({ data: { user: session.user }, requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post('/logout', async (request, response, next) => {
    try {
      await service.logout(request.headers.cookie);
      response.clearCookie(browserSessionCookie, service.clearCookieOptions());
      response.json({ data: { loggedOut: true }, requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

export function createAuthRouter(service: AuthService): Router {
  const router = Router();
  router.put(
    '/account/password',
    validate({ body: passwordChange }),
    async (request, response, next) => {
      try {
        const input = passwordChange.parse(request.body);
        const session = await service.changePassword(
          response.locals.authPrincipal as AuthPrincipal | undefined,
          input.currentPassword,
          input.newPassword,
        );
        response.cookie(browserSessionCookie, session.token, service.cookieOptions());
        response.json({ data: { user: session.user }, requestId: String(request.id) });
      } catch (error) {
        next(error);
      }
    },
  );
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
