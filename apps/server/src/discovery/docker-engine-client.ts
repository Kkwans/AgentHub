import { request as httpRequest } from 'node:http';

import { AppError } from '../errors.js';

export interface DockerEngineContainerSummary {
  id: string;
  names: string[];
  image: string;
  state: string;
  status: string;
  labels: Record<string, string>;
}

export interface DockerEngineContainerInspect {
  id: string;
  name: string;
  image?: string;
  state: {
    status: string;
    running: boolean;
    health?: string | null;
  };
  mounts: Array<{
    type: string;
    source: string;
    destination: string;
    rw: boolean;
  }>;
  labels: Record<string, string>;
}

export interface DockerEngineClient {
  listContainers(all?: boolean): Promise<DockerEngineContainerSummary[]>;
  inspectContainer(idOrName: string): Promise<DockerEngineContainerInspect>;
}

/**
 * Read-only Docker Engine API client. Discovery never shells out to a user supplied command.
 * The client only exposes list/inspect, so adopting a candidate still goes through the pinned
 * ExecutionTargetService identity checks before any Agent can run.
 */
export class DockerSocketEngineClient implements DockerEngineClient {
  constructor(
    private readonly socketPath = process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
    private readonly apiVersion = process.env.DOCKER_ENGINE_API_VERSION ?? 'v1.43',
  ) {}

  async listContainers(all = true): Promise<DockerEngineContainerSummary[]> {
    const data = await this.requestJson(
      `/${this.apiVersion}/containers/json?all=${all ? '1' : '0'}`,
    );
    if (!Array.isArray(data))
      throw new AppError(502, 'DOCKER_ENGINE_INVALID', 'Docker 返回数据格式异常');
    return data.map((item) => {
      const record = asRecord(item);
      return {
        id: stringValue(record.Id),
        names: arrayValue(record.Names),
        image: stringValue(record.Image),
        state: stringValue(record.State),
        status: stringValue(record.Status),
        labels:
          record.Labels && typeof record.Labels === 'object' ? toStringRecord(record.Labels) : {},
      };
    });
  }

  async inspectContainer(idOrName: string): Promise<DockerEngineContainerInspect> {
    const record = asRecord(
      await this.requestJson(`/${this.apiVersion}/containers/${encodeURIComponent(idOrName)}/json`),
    );
    const state = asRecord(record.State);
    const mounts = Array.isArray(record.Mounts)
      ? record.Mounts.map((mount) => {
          const value = asRecord(mount);
          return {
            type: stringValue(value.Type),
            source: stringValue(value.Source),
            destination: stringValue(value.Destination),
            rw: value.RW === true,
          };
        })
      : [];
    const health =
      state.Health && typeof state.Health === 'object'
        ? stringValue(asRecord(state.Health).Status)
        : null;
    const image =
      typeof record.Config === 'object' ? stringValue(asRecord(record.Config).Image) : '';
    return {
      id: stringValue(record.Id),
      name: stringValue(record.Name).replace(/^\//, ''),
      ...(image ? { image } : {}),
      state: {
        status: stringValue(state.Status),
        running: state.Running === true,
        health,
      },
      mounts,
      labels:
        record.Config && typeof record.Config === 'object'
          ? toStringRecord(asRecord(record.Config).Labels)
          : {},
    };
  }

  private requestJson(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        { socketPath: this.socketPath, path, method: 'GET' },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode ?? 500) >= 400) {
              reject(
                new AppError(503, 'DOCKER_ENGINE_UNAVAILABLE', 'Docker Engine 当前不可用', {
                  statusCode: response.statusCode,
                }),
              );
              return;
            }
            try {
              resolve(JSON.parse(body) as unknown);
            } catch (error) {
              reject(
                new AppError(
                  502,
                  'DOCKER_ENGINE_INVALID',
                  'Docker Engine 返回了无法识别的数据',
                  undefined,
                  { cause: error },
                ),
              );
            }
          });
        },
      );
      request.once('error', (error) => {
        reject(
          new AppError(503, 'DOCKER_ENGINE_UNAVAILABLE', 'Docker Engine 当前不可用', undefined, {
            cause: error,
          }),
        );
      });
      request.end();
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
