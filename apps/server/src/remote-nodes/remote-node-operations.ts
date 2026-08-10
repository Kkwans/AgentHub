import type { AgentHubDatabase, RemoteNodeRepository } from '@agenthub/db';

import { AppError } from '../errors.js';
import type {
  FileTreeEntry,
  ProjectPreflightReport,
  RemoteProjectOperations,
} from '../projects/project-service.js';
import { RemoteNodeRpcError, type RemoteNodeGateway } from './remote-node-gateway.js';

export class RemoteNodeOperations implements RemoteProjectOperations {
  constructor(
    private readonly nodes: RemoteNodeRepository<AgentHubDatabase>,
    private readonly gateway: RemoteNodeGateway,
  ) {}

  async preflight(targetId: string, rootPath: string): Promise<ProjectPreflightReport> {
    return this.rpc<ProjectPreflightReport>(targetId, 'project.preflight', { rootPath });
  }

  async listFiles(
    targetId: string,
    rootPath: string,
    requestedPath: string,
    depth: number,
  ): Promise<FileTreeEntry[]> {
    const result = await this.rpc<{ entries: FileTreeEntry[] }>(targetId, 'fs.list', {
      rootPath,
      requestedPath,
      depth,
    });
    return result.entries;
  }

  readFile(targetId: string, rootPath: string, requestedPath: string) {
    return this.rpc<{
      path: string;
      content: string;
      size: number;
      sha256: string;
      modifiedAt: string;
      readOnly: true;
    }>(targetId, 'fs.read', { rootPath, requestedPath });
  }

  private async rpc<T>(
    targetId: string,
    command: 'project.preflight' | 'fs.list' | 'fs.read',
    payload: Record<string, unknown>,
  ): Promise<T> {
    const node = await this.nodes.getByTargetId(targetId);
    if (!node) throw new AppError(404, 'REMOTE_NODE_NOT_FOUND', 'Project 的 Remote Node 不存在');
    if (node.revokedAt) throw new AppError(409, 'REMOTE_NODE_REVOKED', 'Remote Node 已撤销');
    try {
      return (await this.gateway.request(node.id, command, payload)) as T;
    } catch (error) {
      throw remoteRpcAppError(error);
    }
  }
}

export function remoteRpcAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof RemoteNodeRpcError) {
    const status = error.code === 'REMOTE_NODE_OFFLINE' ? 409 : 502;
    return new AppError(status, error.code, error.message, undefined, { cause: error });
  }
  return new AppError(502, 'REMOTE_NODE_RPC_FAILED', 'Remote Node 请求失败', undefined, {
    cause: error,
  });
}
