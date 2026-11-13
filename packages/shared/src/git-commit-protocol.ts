import { z } from 'zod';

// Admission contract for coordinated writes. Legacy keyless requests are rejected
// before dispatch; every production managed writer uses the shared claim.
// Client identifiers are never ownership or executor/resource credentials.
export const gitCommitOperationParams = z.object({
  id: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  operationId: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
});
export const gitCommitOperationBody = z
  .object({
    protocolVersion: z.literal(1),
    operationId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    expectedHead: z
      .string()
      .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i)
      .transform((value) => value.toLowerCase())
      .nullable(),
    message: z.string().trim().min(1).max(10_000),
    mode: z.enum(['STAGED', 'SELECTED']),
    paths: z.array(z.string().min(1).max(4_096)).max(500).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === 'SELECTED' && !input.paths?.length)
      context.addIssue({ code: 'custom', path: ['paths'], message: '必须选择文件' });
    if (input.mode === 'STAGED' && input.paths !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['paths'],
        message: 'STAGED提交不能携带被忽略的paths',
      });
  });
export type GitCommitOperationRequest = z.infer<typeof gitCommitOperationBody>;
