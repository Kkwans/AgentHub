const namedSecretPattern =
  /\b([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*[:=]\s*([^\s,;]+)/gi;
const authorizationPattern = /\b(authorization\s*[:=]\s*(?:bearer\s+)?)([^\s,;]+)/gi;
const jsonSecretPattern = /("(?:apiKey|token|secret|password|authorization)"\s*:\s*")([^"]+)(")/gi;

export function redactSecrets(value: string, additionalSecrets: readonly string[] = []): string {
  let redacted = value
    .replace(namedSecretPattern, '$1=[REDACTED]')
    .replace(authorizationPattern, '$1[REDACTED]')
    .replace(jsonSecretPattern, '$1[REDACTED]$3');

  for (const secret of additionalSecrets) {
    if (secret.length < 4) continue;
    redacted = redacted.replaceAll(secret, '[REDACTED]');
  }
  return redacted;
}
