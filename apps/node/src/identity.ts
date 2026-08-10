import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { remoteNodeSignaturePayload } from '@agenthub/shared';

export interface DeviceRecord {
  nodeId: string;
  targetId: string;
}

export class NodeIdentity {
  private constructor(
    readonly privateKey: KeyObject,
    readonly publicKey: string,
    readonly dataDir: string,
  ) {}

  static async loadOrCreate(dataDir: string): Promise<NodeIdentity> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await chmod(dataDir, 0o700);
    const privateKeyPath = join(dataDir, 'device-private-key.pem');
    let privateKey: KeyObject;
    try {
      privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const generated = generateKeyPairSync('ed25519');
      privateKey = generated.privateKey;
      await writeFile(privateKeyPath, privateKey.export({ format: 'pem', type: 'pkcs8' }), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    await chmod(privateKeyPath, 0o600);
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('设备 private key 不是 Ed25519');
    }
    const publicKey = createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    return new NodeIdentity(privateKey, publicKey, dataDir);
  }

  sign(mode: 'register' | 'authenticate', subject: string, challenge: string): string {
    return sign(
      null,
      remoteNodeSignaturePayload(mode, subject, challenge),
      this.privateKey,
    ).toString('base64');
  }

  async readDeviceRecord(): Promise<DeviceRecord | undefined> {
    try {
      const decoded = JSON.parse(await readFile(join(this.dataDir, 'device.json'), 'utf8')) as {
        nodeId?: unknown;
        targetId?: unknown;
      };
      if (typeof decoded.nodeId !== 'string' || typeof decoded.targetId !== 'string') {
        throw new Error('device.json 内容无效');
      }
      return { nodeId: decoded.nodeId, targetId: decoded.targetId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async writeDeviceRecord(record: DeviceRecord): Promise<void> {
    const destination = join(this.dataDir, 'device.json');
    const temporary = join(this.dataDir, `device.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
    await chmod(destination, 0o600);
  }
}
