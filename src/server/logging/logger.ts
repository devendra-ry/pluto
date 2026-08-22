import 'server-only';

/**
 * Minimal structured JSON logger. One JSON object per line so Vercel log
 * drains and log query tools can filter by fields instead of parsing prose.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const MIN_LEVEL: number = LEVEL_WEIGHT[
    (process.env.LOG_LEVEL as LogLevel | undefined) ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')
] ?? LEVEL_WEIGHT.info;

interface LogContext {
    [key: string]: unknown;
}

function serializeError(error: unknown): LogContext {
    if (error instanceof Error) {
        return { name: error.name, message: error.message, stack: error.stack };
    }
    return { error };
}

function emit(level: LogLevel, message: string, context?: LogContext) {
    if (LEVEL_WEIGHT[level] < MIN_LEVEL) return;

    const entry: LogContext = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...context,
    };

    const line = JSON.stringify(entry);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

export const logger = {
    debug(message: string, context?: LogContext) {
        emit('debug', message, context);
    },
    info(message: string, context?: LogContext) {
        emit('info', message, context);
    },
    warn(message: string, context?: LogContext) {
        emit('warn', message, context);
    },
    error(message: string, error: unknown, context?: LogContext) {
        emit('error', message, { ...serializeError(error), ...context });
    },
};
