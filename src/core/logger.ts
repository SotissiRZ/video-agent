/** Minimal levelled logger. Output goes to stderr so stdout stays usable (JSON output, pipes). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
  child(scope: string): Logger;
}

export const createLogger = (level: LogLevel = 'info', scope = 'video-agent'): Logger => {
  const enabled = (l: LogLevel) => ORDER[l] >= ORDER[level];
  const write = (l: LogLevel, msg: string, rest: unknown[]) => {
    if (!enabled(l)) return;
    const line = `[${scope}] ${l === 'info' ? '' : l.toUpperCase() + ' '}${msg}`;
    console.error(line, ...rest);
  };
  return {
    debug: (m, ...r) => write('debug', m, r),
    info: (m, ...r) => write('info', m, r),
    warn: (m, ...r) => write('warn', m, r),
    error: (m, ...r) => write('error', m, r),
    child: (s) => createLogger(level, `${scope}:${s}`),
  };
};

export const silentLogger = createLogger('silent');
