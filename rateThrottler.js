const _ = require('the-lodash');
const BaseThrottler = require('./baseThrottler');

class RateThrottler extends BaseThrottler
{
    constructor(logger, config)
    {
        super(logger);
        this._config = config;
        this._processedDates = [];
        this._timer = null;

        if (!this.interval) {
            throw new Error("interval not set.")
        }
        if (!this.number) {
            throw new Error("number not set.")
        }
    }

    get interval() {
        return this._config.interval;
    }

    get number() {
        return this._config.number;
    }

    _processTaskChange()
    {
        if (this._timer) {
            return;
        }
        if (this._processedDates.length == 0) {
            return;
        }
        if (!this.hasWaitingActions) {
            return;
        }

        var minDate = _.min(this._processedDates);
        var deltaMs = this.interval - (new Date().getTime() - minDate.getTime());
        if (deltaMs < 50) {
            deltaMs = 50;
        }
        this._logger.silly('Pausing for %sms...', deltaMs);
        this._timer = setTimeout(() => {
            try
            {
                this._timer = null;
                var now = new Date();
                var cutOffTime = now.getTime() - this.interval;
                _.remove(this._processedDates, x => x.getTime() <= cutOffTime);
    
                this._tryProcessWaitingActions();

                this._processTaskChange();
            }
            catch(error)
            {
                this._logger.error('Failed in _processTaskChange.', error);
                this._processTaskChange();
            }
        }, deltaMs);
    }

    _canRun()
    {
        return this._processedDates.length < this.number;
    }

    _onActionStart(actionInfo)
    {
        this._processedDates.push(new Date());
    }

}

module.exports = RateThrottler;
