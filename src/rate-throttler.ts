import _ from 'the-lodash';

import { BaseThrottler } from './base-throttler';
import { ILogger } from './logger';

export interface RateThrottlerConfig {
    interval: number;
    number: number;
}

export class RateThrottler extends BaseThrottler {
    private _config: RateThrottlerConfig;
    private _processedDates: Date[] = [];
    private _timer: NodeJS.Timeout | null = null;

    constructor(logger: ILogger, config: RateThrottlerConfig) {
        super(logger);
        this._config = config;

        if (!this.interval) {
            throw new Error('interval not set.');
        }
        if (!this.number) {
            throw new Error('number not set.');
        }
    }

    get interval(): number {
        return this._config.interval;
    }

    get number(): number {
        return this._config.number;
    }

    protected _processTaskChange(): void {
        if (this._timer) {
            return;
        }
        if (this._processedDates.length == 0) {
            return;
        }
        if (!this.hasWaitingActions) {
            return;
        }

        const minDate = _.min(this._processedDates)!;
        let deltaMs = this.interval - (new Date().getTime() - minDate.getTime());
        if (deltaMs < 50) {
            deltaMs = 50;
        }
        this._logger.silly('Pausing for %sms...', deltaMs);
        this._timer = setTimeout(() => {
            try {
                this._timer = null;
                const now = new Date();
                const cutOffTime = now.getTime() - this.interval;
                _.remove(this._processedDates, (x) => x.getTime() <= cutOffTime);

                this._tryProcessWaitingActions();

                this._processTaskChange();
            } catch (error) {
                this._logger.error('Failed in _processTaskChange.', error);
                this._processTaskChange();
            }
        }, deltaMs);
    }

    protected _canRun(): boolean {
        return this._processedDates.length < this.number;
    }

    protected _onActionStart(): void {
        this._processedDates.push(new Date());
    }
}
