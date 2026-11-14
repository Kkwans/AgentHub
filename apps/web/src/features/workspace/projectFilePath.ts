import { ApiError } from '../../lib/api-error';

const invalid = () =>
  new ApiError(
    'PROJECT_FILE_PATH_INVALID',
    '文件路径不在当前 Project 范围内，或包含不安全的路径片段。未发起读取。',
    400,
  );

/** Transport adaptation only. The server still enforces realpath/symlink containment. */
export function projectFileRequestPath(root: string, original: string): string {
  if (!original || original.includes('\0')) throw invalid();
  const path = original.replaceAll('\\', '/');
  const absolute = path.startsWith('/') || /^[A-Za-z]:\//.test(path);
  let relative = path;
  if (absolute) {
    const canonicalRoot = root.replaceAll('\\', '/').replace(/\/+$/, '');
    if (
      canonicalRoot.includes('//') ||
      canonicalRoot.split('/').some((segment) => segment === '.' || segment === '..')
    )
      throw invalid();
    const prefix = canonicalRoot + '/';
    if (!root || (!canonicalRoot && root !== '/') || !path.startsWith(prefix)) throw invalid();
    relative = path.slice(prefix.length);
  }
  if (!relative) throw invalid();
  let candidate = relative;
  for (let round = 0; round <= 2; round += 1) {
    if (
      candidate.includes('\0') ||
      candidate.replaceAll('\\', '/').startsWith('/') ||
      /^[A-Za-z]:/.test(candidate) ||
      candidate.replaceAll('\\', '/').split('/').includes('..')
    )
      throw invalid();
    if (round < 2) {
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        throw invalid();
      }
    }
  }
  const result = relative.replace(/^\.\//, '');
  if (!result || result === '.') throw invalid();
  return result;
}
