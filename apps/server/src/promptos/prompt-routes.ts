import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../validation.js';
import type { PromptService } from './prompt-service.js';

const uuid = z.string().uuid();
const promptParams = z.object({ id: uuid });
const versionParams = z.object({ id: uuid, version: z.coerce.number().int().positive() });
const labelParams = z.object({ id: uuid, label: z.string().trim().min(1).max(120) });
const bindingParams = z.object({ id: uuid });
const promptKind = z.enum(['SYSTEM', 'TASK', 'REVIEW', 'COMMIT', 'RULE', 'TEMPLATE']);
const promptType = z.enum(['TEXT', 'CHAT']);
const targetType = z.enum(['PROJECT', 'AGENT', 'TASK']);
const slot = z.enum(['SYSTEM', 'TASK_PRIMER', 'REVIEW', 'COMMIT', 'RULES']);
const selectorType = z.enum(['LABEL', 'VERSION']);
const jsonObject = z.record(z.string(), z.unknown());

const promptListQuery = z.object({ projectId: uuid.optional() });
const createPromptSchema = z.object({
  projectId: uuid.optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/),
  name: z.string().trim().min(1).max(240),
  description: z.string().max(4_000).optional(),
  kind: promptKind,
  type: promptType,
});
const updatePromptSchema = z
  .object({
    name: z.string().trim().min(1).max(240).optional(),
    description: z.string().max(4_000).nullable().optional(),
    kind: promptKind.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: '至少提供一个修改字段' });
const createVersionSchema = z.object({
  content: jsonObject,
  variables: jsonObject.optional(),
  config: jsonObject.optional(),
  changelog: z.string().max(4_000).optional(),
  source: z.string().trim().min(1).max(120).optional(),
  createdBy: z.string().trim().min(1).max(160).optional(),
});
const diffQuery = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});
const moveLabelSchema = z.object({ versionId: uuid });
const renderSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    version: z.number().int().positive().optional(),
    variables: jsonObject.optional(),
  })
  .refine((input) => !(input.label && input.version), {
    message: 'label 与 version 不能同时提供',
  });
const bindingQuery = z.object({
  targetType: targetType.optional(),
  targetId: uuid.optional(),
  promptId: uuid.optional(),
});
const bindingBase = z.object({
  targetType,
  targetId: uuid,
  slot,
  promptId: uuid,
  selectorType,
  label: z.string().trim().min(1).max(120).optional(),
  versionId: uuid.optional(),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
  enabled: z.boolean().optional(),
});
const createBindingSchema = bindingBase.superRefine(validateSelector);
const updateBindingSchema = z
  .object({
    slot: slot.optional(),
    selectorType: selectorType.optional(),
    label: z.string().trim().min(1).max(120).nullable().optional(),
    versionId: uuid.nullable().optional(),
    priority: z.number().int().min(-10_000).max(10_000).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: '至少提供一个修改字段' });
const resolveSchema = z.object({
  projectId: uuid,
  agentId: uuid.optional(),
  taskId: uuid.optional(),
  variables: jsonObject.optional(),
});
const skillQuery = z.object({ projectId: uuid.optional() });
const skillScanSchema = z.object({ projectId: uuid });
const skillBindingQuery = z.object({
  targetType: targetType.optional(),
  targetId: uuid.optional(),
});
const skillBindingSchema = z.object({
  skillId: uuid,
  targetType,
  targetId: uuid,
  enabled: z.boolean().optional(),
});

export function createPromptOsRouter(service: PromptService): Router {
  const router = Router();

  router.get('/prompts', validate({ query: promptListQuery }), async (request, response, next) => {
    try {
      const { projectId } = promptListQuery.parse(request.query);
      response.json({ data: await service.list(projectId), requestId: String(request.id) });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/prompts',
    validate({ body: createPromptSchema }),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.create(createPromptSchema.parse(request.body)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/prompts/:id',
    validate({ params: promptParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.get(promptParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.patch(
    '/prompts/:id',
    validate({ params: promptParams, body: updatePromptSchema }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.update(
            promptParams.parse(request.params).id,
            updatePromptSchema.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/prompts/:id/archive',
    validate({ params: promptParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.archive(promptParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/prompts/:id/versions',
    validate({ params: promptParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.listVersions(promptParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/prompts/:id/versions',
    validate({ params: promptParams, body: createVersionSchema }),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.createVersion(
            promptParams.parse(request.params).id,
            createVersionSchema.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/prompts/:id/versions/:version',
    validate({ params: versionParams }),
    async (request, response, next) => {
      try {
        const params = versionParams.parse(request.params);
        response.json({
          data: await service.getVersion(params.id, params.version),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/prompts/:id/diff',
    validate({ params: promptParams, query: diffQuery }),
    async (request, response, next) => {
      try {
        const { id } = promptParams.parse(request.params);
        const query = diffQuery.parse(request.query);
        response.json({
          data: await service.diff(id, query.from, query.to),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/prompts/:id/labels',
    validate({ params: promptParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.listLabels(promptParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.put(
    '/prompts/:id/labels/:label',
    validate({ params: labelParams, body: moveLabelSchema }),
    async (request, response, next) => {
      try {
        const params = labelParams.parse(request.params);
        response.json({
          data: await service.moveLabel(
            params.id,
            params.label,
            moveLabelSchema.parse(request.body).versionId,
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.delete(
    '/prompts/:id/labels/:label',
    validate({ params: labelParams }),
    async (request, response, next) => {
      try {
        const params = labelParams.parse(request.params);
        response.json({
          data: await service.deleteLabel(params.id, params.label),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/prompts/:id/render',
    validate({ params: promptParams, body: renderSchema }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.render(
            promptParams.parse(request.params).id,
            renderSchema.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/prompt-bindings',
    validate({ query: bindingQuery }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.listBindings(bindingQuery.parse(request.query)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/prompt-bindings',
    validate({ body: createBindingSchema }),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.createBinding(createBindingSchema.parse(request.body)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.patch(
    '/prompt-bindings/:id',
    validate({ params: bindingParams, body: updateBindingSchema }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.updateBinding(
            bindingParams.parse(request.params).id,
            updateBindingSchema.parse(request.body),
          ),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.delete(
    '/prompt-bindings/:id',
    validate({ params: bindingParams }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.deleteBinding(bindingParams.parse(request.params).id),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/prompt-context/resolve',
    validate({ body: resolveSchema }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.resolve(resolveSchema.parse(request.body)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/skills', validate({ query: skillQuery }), async (request, response, next) => {
    try {
      response.json({
        data: await service.listSkills(skillQuery.parse(request.query).projectId),
        requestId: String(request.id),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post(
    '/skills/scan',
    validate({ body: skillScanSchema }),
    async (request, response, next) => {
      try {
        response.json({
          data: await service.scanSkills(skillScanSchema.parse(request.body).projectId),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/skill-bindings',
    validate({ query: skillBindingQuery }),
    async (request, response, next) => {
      try {
        const query = skillBindingQuery.parse(request.query);
        response.json({
          data: await service.listSkillBindings(query.targetType, query.targetId),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    '/skill-bindings',
    validate({ body: skillBindingSchema }),
    async (request, response, next) => {
      try {
        response.status(201).json({
          data: await service.createSkillBinding(skillBindingSchema.parse(request.body)),
          requestId: String(request.id),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

function validateSelector(
  input: {
    selectorType: 'LABEL' | 'VERSION';
    label?: string | undefined;
    versionId?: string | undefined;
  },
  context: z.RefinementCtx,
) {
  if (input.selectorType === 'LABEL' && (!input.label || input.versionId)) {
    context.addIssue({
      code: 'custom',
      path: ['label'],
      message: 'LABEL selector 必须只提供 label',
    });
  }
  if (input.selectorType === 'VERSION' && (!input.versionId || input.label)) {
    context.addIssue({
      code: 'custom',
      path: ['versionId'],
      message: 'VERSION selector 必须只提供 versionId',
    });
  }
}
