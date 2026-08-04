import { isTest } from '../config/env.js';

type Level = 'INFO' | 'WARN' | 'ERROR';

/** Strips bearer tokens, which routinely appear in error dumps. */
const scrub = (msg: string) => msg.replace(/(?<=Bearer )[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]');

const emit = (level: Level, msg: string, meta: unknown[]) => {
  // Keep test output readable; errors still surface.
  if (isTest && level !== 'ERROR') return;

  const line = `[${level}] [${new Date().toISOString()}] ${scrub(msg)}`;
  const sink = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  sink(line, ...meta);
};

export const logger = {
  info: (msg: string, ...meta: unknown[]) => emit('INFO', msg, meta),
  warn: (msg: string, ...meta: unknown[]) => emit('WARN', msg, meta),
  error: (msg: string, ...meta: unknown[]) => emit('ERROR', msg, meta),
};
