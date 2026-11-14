// Apply at both the process logger and the HTTP child logger. Custom app
// loggers must not accidentally expose authentication headers or issued cookies.
export const logRedaction = {
  paths: [
    'req.body.query',
    'request.body.query',
    'req.headers.authorization',
    'request.headers.authorization',
    'headers.authorization',
    'req.headers.cookie',
    'request.headers.cookie',
    'headers.cookie',
    'res.headers["set-cookie"]',
    'response.headers["set-cookie"]',
    'headers["set-cookie"]',
    '*.token',
    '*.password',
    '*.currentPassword',
    '*.newPassword',
    '*.secret',
  ],
  censor: '[REDACTED]',
};
