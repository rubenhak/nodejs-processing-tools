const _ = require('the-lodash');
const Promise = require('the-promise');
const uuid = require('uuid/v4');

class BaseThrottler
{
    constructor(logger)
    {
        this._logger = logger;
        this._runningActions = {};
        this._waitingActions = [];
    }

    get hasWaitingActions() {
        return this._waitingActions.length > 0;
    }   

    execute(action, name)
    {
        if (!_.isFunction(action)) {
            throw new Error("Action should be a function what returns Promise");
        }

        return new Promise((resolve, reject) => {
            var actionInfo = {
                id: uuid(),
                name: name,
                dateScheduled: new Date(),
                dateStarted: null,
                action: action,
                resolve: resolve,
                reject: reject
            };

            try
            {
                if (this._canRun())
                {
                    this._executeAction(actionInfo);
                }
                else
                {
                    this._scheduleAction(actionInfo);
                }
            }
            catch(error)
            {
                this._logger.warn('Failed in root for %s.', actionInfo.name, error);
                this._rejectAction(actionInfo, error)
            }
        });
    }

    _canRun()
    {
        throw new Error("NOT IMPLEMENTED")
    }

    _scheduleAction(actionInfo)
    {
        this._logger.silly('Scheduled %s.', actionInfo.name);
        this._waitingActions.push(actionInfo);
        this._processTaskChange();
    }

    _resolveAction(actionInfo, result)
    {
        this._logger.verbose('Completed %s.', actionInfo.name);
        delete this._runningActions[actionInfo.id];
        actionInfo.resolve(result);
        this._processTaskChange();
    }

    _rejectAction(actionInfo, reason)
    {
        this._logger.warn('Failed %s.', actionInfo.name);
        delete this._runningActions[actionInfo.id];
        actionInfo.reject(reason);
        this._processTaskChange();
    }

    _processTaskChange()
    {

    }

    _onActionStart(actionInfo)
    {

    }

    _executeAction(actionInfo)
    {
        this._logger.info('Executing %s...', actionInfo.name);
        actionInfo.dateStarted = new Date();
        this._runningActions[actionInfo.id] = actionInfo;
        this._onActionStart(actionInfo);
        try {
            return Promise.try(actionInfo.action)
                .then(result => {
                    this._resolveAction(actionInfo, result);
                })
                .catch(reason => {
                    this._rejectAction(actionInfo, reason);
                });
        } catch (e) {
            this._rejectAction(actionInfo, reason);
        }
    }

    _tryProcessWaitingActions()
    {
        while(this.hasWaitingActions && this._canRun())
        {
            var actionInfo = this._waitingActions.splice(0, 1)[0];
            this._executeAction(actionInfo);
        }
    }
}

module.exports = BaseThrottler;
