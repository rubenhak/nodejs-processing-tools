export interface IOutputWriter {
    write(value?: any): void;
    writeHeader(value?: any): void;
    indent(): void;
    unindent(): void;
    close(): any;
}

export interface ILogger {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    crit(...args: any[]): void;
    verbose(...args: any[]): void;
    debug(...args: any[]): void;
    silly(...args: any[]): void;
    exception(error: any): void;
    sublogger(name: string): ILogger;
    outputFile(fileName: string, data: any): any;
    outputStream(fileName: string): IOutputWriter | null;
}
