import _ from 'the-lodash';

import { BaseThrottler } from './base-throttler';
import { ILogger } from './logger';

export interface ConcurrentThrottlerConfig {
    number: number;
}

export class ConcurrentThrottler extends BaseThrottler {
    private _config: ConcurrentThrottlerConfig;

    constructor(logger: ILogger, config: ConcurrentThrottlerConfig) {
        super(logger);
        this._config = config;

        if (!this.number) {
            throw new Error('number not set.');
        }
    }

    get number(): number {
        return this._config.number;
    }

    protected _canRun(): boolean {
        return _.keys(this._runningActions).length < this.number;
    }

    protected _processTaskChange(): void {
        this._tryProcessWaitingActions();
    }
}
