const _ = require('the-lodash');
const BaseThrottler = require('./baseThrottler');

class ConcurrentThrottler extends BaseThrottler
{
    constructor(logger, config)
    {
        super(logger);
        this._config = config;

        if (!this.number) {
            throw new Error("number not set.")
        }
    }

    get number() {
        return this._config.number;
    }

    _canRun()
    {
        return _.keys(this._runningActions).length < this.number;
    }

    _processTaskChange()
    {
        this._tryProcessWaitingActions();
    }

}

module.exports = ConcurrentThrottler;
