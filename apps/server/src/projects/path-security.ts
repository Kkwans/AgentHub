import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { AppError } from '../errors.js';

export function validateRelativePath(requestedPath: string): string {
  if (requestedPath.includes('\0') || requestedPath.includes('\u0000')) {
    throw new AppError(400, 'PATH_INVALID', '路径包含非法字符');
  }
  const candidates = [requestedPath];
  let decoded = requestedPath;
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
      candidates.push(decoded);
    } catch {
      throw new AppError(400, 'PATH_ENCODING_INVALID', '路径编码不合法');
    }
  }
  for (const candidate of candidates) {
    if (isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
      throw new AppError(400, 'PATH_ABSOLUTE_FORBIDDEN', '文件路径必须相对于 Project root');
    }
    const segments = candidate.replaceAll('\\', '/').split('/');
    if (segments.includes('..')) {
      throw new AppError(400, 'PATH_TRAVERSAL', '文件路径不能包含上级目录跳转');
    }
  }
  return requestedPath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export async function resolveContainedExistingPath(
  canonicalRoot: string,
  requestedPath: string,
): Promise<string> {
  const relativePath = validateRelativePath(requestedPath);
  const lexical = resolve(canonicalRoot, relativePath);
  assertContained(canonicalRoot, lexical, 'PATH_TRAVERSAL');
  let canonical: string;
  try {
    canonical = await realpath(lexical);
  } catch (error) {
    throw new AppError(404, 'FILE_NOT_FOUND', '文件或目录不存在', undefined, { cause: error });
  }
  assertContained(canonicalRoot, canonical, 'SYMLINK_ESCAPE');
  return canonical;
}

export function assertContained(root: string, candidate: string, code: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === '') return;
  if (isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    throw new AppError(403, code, '请求的路径超出 Project root');
  }
}
