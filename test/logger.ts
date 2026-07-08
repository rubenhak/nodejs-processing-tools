import { ILogger, IOutputWriter } from '../src';

const LEVELS = ['info', 'warn', 'error', 'crit', 'verbose', 'debug', 'silly'] as const;

const logger: Record<string, any> = {};

for (const level of LEVELS) {
    logger[level] = function (..._args: any[]): void {
        // silent test logger
    };
}

logger.exception = function (_error: any): void {
    // silent test logger
};

logger.sublogger = function (_name: string): ILogger {
    return logger as ILogger;
};

logger.outputFile = function (_fileName: string, _data: any): any {
    return Promise.resolve();
};

logger.outputStream = function (_fileName: string): IOutputWriter | null {
    return null;
};

export default logger as ILogger;
