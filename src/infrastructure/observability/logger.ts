import pino, { type Logger } from 'pino';

export function createLogger(level: string): Logger {
  return pino({
    level,
    // One field name for correlation everywhere: log lines, response header, problem+json.
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-actor-id"]', // an actor handle is personal data; the item id is enough
      ],
      censor: '[redacted]',
    },
    ...(process.env.NODE_ENV !== 'production'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
      : {}),
  });
}
