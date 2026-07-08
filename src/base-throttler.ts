import _ from 'the-lodash';
import { MyPromise, Resolvable } from 'the-promise';
import { v4 as uuid } from 'uuid';

import { ILogger } from './logger';

export type ThrottlerAction<T> = () => Resolvable<T>;

export interface ActionInfo<T = any> {
    id: string;
    name: string;
    dateScheduled: Date;
    dateStarted: Date | null;
    action: ThrottlerAction<T>;
    resolve: (result: Resolvable<T>) => void;
    reject: (reason?: any) => void;
}

export class BaseThrottler {
    protected _logger: ILogger;
    protected _runningActions: Record<string, ActionInfo> = {};
    protected _waitingActions: ActionInfo[] = [];

    constructor(logger: ILogger) {
        this._logger = logger;
    }

    get hasWaitingActions(): boolean {
        return this._waitingActions.length > 0;
    }

    execute<T>(action: ThrottlerAction<T>, name: string): Promise<T> {
        if (!_.isFunction(action)) {
            throw new Error('Action should be a function what returns Promise');
        }

        return MyPromise.construct<T>((resolve, reject) => {
            const actionInfo: ActionInfo<T> = {
                id: uuid(),
                name: name,
                dateScheduled: new Date(),
                dateStarted: null,
                action: action,
                resolve: resolve,
                reject: reject,
            };

            try {
                if (this._canRun()) {
                    this._executeAction(actionInfo);
                } else {
                    this._scheduleAction(actionInfo);
                }
            } catch (error) {
                this._logger.warn('Failed in root for %s.', actionInfo.name, error);
                this._rejectAction(actionInfo, error);
            }
        });
    }

    protected _canRun(): boolean {
        throw new Error('NOT IMPLEMENTED');
    }

    protected _scheduleAction(actionInfo: ActionInfo): void {
        this._logger.silly('Scheduled %s.', actionInfo.name);
        this._waitingActions.push(actionInfo);
        this._processTaskChange();
    }

    protected _resolveAction(actionInfo: ActionInfo, result: any): void {
        this._logger.verbose('Completed %s.', actionInfo.name);
        delete this._runningActions[actionInfo.id];
        actionInfo.resolve(result);
        this._processTaskChange();
    }

    protected _rejectAction(actionInfo: ActionInfo, reason?: any): void {
        this._logger.warn('Failed %s.', actionInfo.name);
        delete this._runningActions[actionInfo.id];
        actionInfo.reject(reason);
        this._processTaskChange();
    }

    protected _processTaskChange(): void {}

    protected _onActionStart(actionInfo: ActionInfo): void {}

    protected _executeAction(actionInfo: ActionInfo): void {
        this._logger.info('Executing %s...', actionInfo.name);
        actionInfo.dateStarted = new Date();
        this._runningActions[actionInfo.id] = actionInfo;
        this._onActionStart(actionInfo);
        try {
            MyPromise.try(actionInfo.action)
                .then((result) => {
                    this._resolveAction(actionInfo, result);
                    return null;
                })
                .catch((reason) => {
                    this._rejectAction(actionInfo, reason);
                    return null;
                });
        } catch (e) {
            this._rejectAction(actionInfo, e);
        }
    }

    protected _tryProcessWaitingActions(): void {
        while (this.hasWaitingActions && this._canRun()) {
            const actionInfo = this._waitingActions.splice(0, 1)[0];
            this._executeAction(actionInfo);
        }
    }
}
