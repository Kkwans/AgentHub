import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const keyLength = 64;
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const maxmem = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return [
    'scrypt',
    String(cost),
    String(blockSize),
    String(parallelization),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, rawCost, rawBlockSize, rawParallelization, rawSalt, rawExpected] =
    encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    Number(rawCost) !== cost ||
    Number(rawBlockSize) !== blockSize ||
    Number(rawParallelization) !== parallelization ||
    !rawSalt ||
    !rawExpected
  ) {
    return false;
  }
  const expected = Buffer.from(rawExpected, 'base64url');
  if (expected.length !== keyLength) return false;
  const actual = await derive(password, Buffer.from(rawSalt, 'base64url'));
  return timingSafeEqual(actual, expected);
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: cost, r: blockSize, p: parallelization, maxmem },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}
