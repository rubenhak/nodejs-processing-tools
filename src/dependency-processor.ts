import _ from 'the-lodash';
import { MyPromise } from 'the-promise';

import { ILogger } from './logger';

export enum TaskState {
    Idle = 'Idle',
    Running = 'Running',
    WaitingFinish = 'WaitingFinish',
    Complete = 'Complete',
    Error = 'Error',
    Unqualified = 'Unqualified',
    Skipped = 'Skipped',
}

/**
 * Result returned by a task completion checker to decide the next step.
 */
export interface CompletionCheckResult {
    ready?: boolean;
    retry?: boolean;
    timeout?: number;
}

export type CompletionCheckerCb = () => CompletionCheckResult | null | undefined | false;
export type PreRunCheckerCb = () => boolean;

export interface Task<TId = any> {
    name: string;
    id?: TId;
    dn?: string;
    state: TaskState;
    predecessors: Record<string, boolean>;
    labels: string[];
    nonConcurrentLabels: string[];
    completionCheckerCb: CompletionCheckerCb | null;
    preRunCheckerCb?: PreRunCheckerCb | null;
}

export interface TaskErrorInfo<TId = any> {
    taskId: TId;
    origError: any;
    errorName?: string;
    message?: string;
    stack?: string[];
}

export type TaskHandler<TId = any> = (id: TId) => boolean | Promise<boolean>;

export class DependencyProcessor<TId = any> {
    private _handler: TaskHandler<TId>;
    private _logger: ILogger;
    private _tasks: Record<string, Task<TId>>;
    private _idleTasks: Record<string, Task<TId>>;
    private _failedTasks: Record<string, Task<TId>>;
    private _runningTasks: Record<string, Task<TId>>;
    private _currentLabels: Record<string, Record<string, boolean>>;
    private _taskErrors: TaskErrorInfo<TId>[];
    private _isRunning: boolean;
    private _id: string;
    private _isInsideStep: boolean;
    private _isStepScheduled = false;
    private _healthTimer: NodeJS.Timeout | null = null;
    private _resolveCb: (() => void) | null = null;
    private _rejectCb: ((reason?: any) => void) | null = null;

    constructor(logger: ILogger, id: string, handler: TaskHandler<TId>) {
        this._handler = handler;
        this._logger = logger;
        this._tasks = {};
        this._idleTasks = {};
        this._failedTasks = {};
        this._runningTasks = {};
        this._currentLabels = {};
        this._taskErrors = [];
        this._isRunning = false;
        this._id = id;
        this._isInsideStep = false;
    }

    private _clearHealthChecker(): void {
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }
    }

    private _setupHealthChecker(): void {
        this._clearHealthChecker();
        this._healthTimer = setInterval(() => this._processHealthCheck(), 30 * 1000);
    }

    get tasksByState(): Record<string, Task<TId>[]> {
        const tasksByState: Record<string, Task<TId>[]> = _.chain(this._tasks)
            .values()
            .groupBy((x) => x.state)
            .value();
        for (const state of _.keys(TaskState)) {
            if (!(state in tasksByState)) {
                tasksByState[state] = [];
            }
        }
        return tasksByState;
    }

    get taskErrors(): TaskErrorInfo<TId>[] {
        return this._taskErrors;
    }

    private _processHealthCheck(): void {
        this._logger.info('Health Check Started...');

        const tasksByState = this.tasksByState;

        for (const taskStatus of _.keys(tasksByState)) {
            this._logger.info('Tasks %s. Count=%s.', taskStatus, tasksByState[taskStatus].length);
        }

        for (const taskStatus of _.keys(tasksByState)) {
            this._logger.info('**** %s Tasks. Count=%s.', taskStatus, tasksByState[taskStatus].length);
            for (const task of _.orderBy(tasksByState[taskStatus], (x) => x.dn)) {
                this._logger.info('  -> %s is %s...', task.name, taskStatus);
                this._logger.info('     predecessors:', _.keys(task.predecessors));
            }
        }

        this._logger.info('Health check complete.');
    }

    addTask(id: TId): void {
        const name = JSON.stringify(id);
        const task = this._setupTask(name);
        task.id = id;
    }

    setDependency(id: TId, predecessorId: TId): void {
        const name = JSON.stringify(id);
        const predecessorName = JSON.stringify(predecessorId);
        const task = this._setupTask(name);
        task.predecessors[predecessorName] = true;
    }

    setLabel(id: TId, label: string): void {
        const name = JSON.stringify(id);
        const task = this._setupTask(name);
        task.labels.push(label);
    }

    setCompletionChecker(id: TId, cb: CompletionCheckerCb): void {
        const name = JSON.stringify(id);
        const task = this._setupTask(name);
        task.completionCheckerCb = cb;
    }

    setPreRunChecker(id: TId, cb: PreRunCheckerCb): void {
        const name = JSON.stringify(id);
        const task = this._setupTask(name);
        task.preRunCheckerCb = cb;
    }

    setNonConcurrentLabels(id: TId, labels: string[]): void {
        const name = JSON.stringify(id);
        const task = this._setupTask(name);
        for (const label of labels) {
            task.nonConcurrentLabels.push(label);
        }
    }

    private _setupTask(name: string): Task<TId> {
        if (!(name in this._tasks)) {
            this._tasks[name] = {
                name: name,
                state: TaskState.Idle,
                predecessors: {},
                labels: [],
                nonConcurrentLabels: [],
                completionCheckerCb: null,
            };

            this._idleTasks[name] = this._tasks[name];
        }
        return this._tasks[name];
    }

    process(): Promise<void> {
        this._logger.info('Processing started. %s', this._id);

        this._isStepScheduled = false;
        this._isRunning = true;
        this._setupHealthChecker();
        return MyPromise.construct<void>((resolve, reject) => {
            this._resolveCb = resolve;
            this._rejectCb = reject;
            this._step('process');
        });
    }

    close(): void {
        if (!this._isRunning) {
            return;
        }
        this._isRunning = false;

        this._logger.info('Processing stopped. %s', this._id);
        this._resolveCb = null;
        this._rejectCb = null;
        this._clearHealthChecker();
    }

    private _step(callerName: string, _timeout?: number): void {
        this._logger.verbose('[_step] begin. callerName: %s', callerName);
        if (this._isStepScheduled) {
            return;
        }
        this._isStepScheduled = true;
        setImmediate(() => {
            this._runStep();
        });
    }

    private _runStep(): void {
        this._logger.verbose('[_runStep] begin. isrunning: %s', this._isRunning);
        if (!this._isRunning) {
            return;
        }

        this._isStepScheduled = false;
        this._setupHealthChecker();

        try {
            if (this._isInsideStep) {
                throw new Error('ALREADY INSIDE DEPENDENCY PROCESSOR RUN-STEP');
            }
            this._isInsideStep = true;

            this._logger.info('[_runStep] failedTasks: %s', _.keys(this._failedTasks).length);
            this._logger.info('[_runStep] idleTasks: %s', _.keys(this._idleTasks).length);
            this._logger.info('[_runStep] runningTasks: %s', _.keys(this._runningTasks).length);

            if (_.keys(this._failedTasks).length > 0) {
                this._finishWithFailure();
                return;
            }

            if (_.keys(this._idleTasks).length == 0 && _.keys(this._runningTasks).length == 0) {
                this._finishWithSuccess();
                return;
            }

            const readyToRunTasks = _.values(this._idleTasks).filter((x) => this._arePredecessorsCompleted(x));
            this._logger.info('[_runStep] readyToRunTasks: %s', readyToRunTasks.length);
            const nonConcurrentTasksToRun = readyToRunTasks.filter((x) => this._areConcurrentLabelsAvailable(x));
            this._logger.info('[_runStep] nonConcurrentTasksToRun: %s', nonConcurrentTasksToRun.length);

            const tasksToSkip = nonConcurrentTasksToRun.filter((x) => !this._checkIfTaskPreRun(x));
            if (tasksToSkip.length > 0) {
                this._logger.info('[_runStep] tasksToSkip: %s', tasksToSkip.length);
                for (const task of tasksToSkip) {
                    this._markUnqualified(task);
                }
                this._step('_runStep::afterTaskSkip');
            } else {
                this._logger.info('[_runStep] tasksToRun: %s', nonConcurrentTasksToRun.length);
                for (const task of nonConcurrentTasksToRun) {
                    let startedTasks = false;
                    if (this._areConcurrentLabelsAvailable(task)) {
                        startedTasks = true;
                        this._runTask(task);
                    }
                    if (startedTasks) {
                        setTimeout(() => {
                            this._step('_runStep::afterTaskStart', 1000);
                        });
                    }
                }
            }
        } catch (e) {
            this._logger.error('Error in _step.%s ', this._id, e);
            this._logger.exception(e);
            this._step('_runStep::catch');
        } finally {
            this._isInsideStep = false;
        }
    }

    private _markUnqualified(task: Task<TId>): void {
        this._markFinalState(task, TaskState.Unqualified, '_markUnqualified');
        this._markDependentsSkipped(task.name);
    }

    private _checkIfTaskPreRun(task: Task<TId>): boolean {
        if (task.preRunCheckerCb) {
            this._logger.verbose('Checking pre run conditions for %s ...', task.name);
            const result = task.preRunCheckerCb();
            this._logger.verbose('Task %s prerun check result = %s.', task.name, result);
            if (result) {
                return true;
            } else {
                return false;
            }
        }
        return true;
    }

    private _runTask(task: Task<TId>): void {
        this._logger.info('Running %s...', task.name);
        delete this._idleTasks[task.name];
        this._runningTasks[task.name] = task;
        task.state = TaskState.Running;
        this._markTaskLabel(task);
        if (!task.id) {
            this._logger.warn('Task %s does not have id...', task.name);
            this._markTaskComplete(task);
            return;
        }

        Promise.resolve(this._handler(task.id))
            .then((canContinue) => {
                if (canContinue) {
                    this._logger.info('Completed: %s', task.name);
                    return this._runPostTaskFinish(task);
                } else {
                    this._logger.info('Unqualified: %s', task.name);
                    this._markUnqualified(task);
                    this._step('_runTask::unqualified');
                }
            })
            .catch((error) => {
                this._logger.error('%s failed. Error', task.name, error);
                this._failedTasks[task.name] = task;

                const errorInfo: TaskErrorInfo<TId> = {
                    taskId: task.id!,
                    origError: error,
                };
                if (error) {
                    errorInfo.errorName = error.name;
                    errorInfo.message = error.message;
                    if (error.stack) {
                        errorInfo.stack = error.stack.split('\n').slice(1);
                    }
                }
                this._taskErrors.push(errorInfo);

                this._markFinalState(task, TaskState.Error, '_runTask::catch');
            });
    }

    private _markFinalState(task: Task<TId>, state: TaskState, reason: string): void {
        this._logger.info('Task %s => %s...', task.name, state);

        delete this._idleTasks[task.name];
        delete this._runningTasks[task.name];
        task.state = state;
        this._unmarkTaskLabel(task);
        this._step(reason);
    }

    private _runPostTaskFinish(task: Task<TId>): any {
        task.state = TaskState.WaitingFinish;
        return this._checkTaskCompletion(task, false);
    }

    private _checkTaskCompletion(task: Task<TId>, calledFromTimer: boolean): any {
        try {
            if (task.completionCheckerCb) {
                this._logger.info('Running %s CompletionChecker. CalledFromTimer=%s...', task.name, calledFromTimer);
                const completionResult = task.completionCheckerCb();
                this._logger.info('Task %s completion result: ', task.name, completionResult);
                if (!completionResult) {
                    this._markUnqualified(task);
                } else {
                    if (completionResult.ready) {
                        this._markTaskComplete(task);
                    } else {
                        if (completionResult.retry) {
                            return MyPromise.timeout(completionResult.timeout! * 1000).then(() =>
                                this._checkTaskCompletion(task, true),
                            );
                        } else {
                            this._markUnqualified(task);
                        }
                    }
                }
            } else {
                this._markTaskComplete(task);
            }
        } catch (e) {
            this._logger.error('Exception inside _checkTaskCompletion', e);
            this._logger.exception(e);
        }
    }

    private _markTaskComplete(task: Task<TId>): void {
        this._markFinalState(task, TaskState.Complete, '_markTaskComplete');
    }

    private _markTaskLabel(task: Task<TId>): void {
        for (const label of task.labels) {
            this._logger.info('Marking task %s label %s...', task.name, label);

            if (!(label in this._currentLabels)) {
                this._currentLabels[label] = {};
            }
            this._currentLabels[label][task.name] = true;
        }
    }

    private _unmarkTaskLabel(task: Task<TId>): void {
        for (const label of task.labels) {
            this._logger.info('Clearing task %s label %s...', task.name, label);

            if (label in this._currentLabels) {
                const dict = this._currentLabels[label];
                delete dict[task.name];
                if (_.keys(dict).length == 0) {
                    delete this._currentLabels[label];
                }
            }
        }
    }

    private _arePredecessorsCompleted(task: Task<TId>): boolean {
        for (const predecessorName of _.keys(task.predecessors)) {
            const predecessor = this._tasks[predecessorName];
            if (predecessor) {
                if (predecessor.state != TaskState.Complete) {
                    return false;
                }
            }
        }
        return true;
    }

    private _areConcurrentLabelsAvailable(task: Task<TId>): boolean {
        for (const label of task.nonConcurrentLabels) {
            if (label in this._currentLabels) {
                return false;
            }
        }
        return true;
    }

    private _markDependentsSkipped(name: string): void {
        const dependents = this._getDependentTasks(name);

        const others: Task<TId>[] = [];
        for (const task of dependents) {
            if (task.state == TaskState.Idle) {
                others.push(task);
                this._markFinalState(task, TaskState.Skipped, '_markDependentsSkipped');

                this._logger.info('Skipped task %s.', task.name);
            }
        }
        for (const task of others) {
            this._markDependentsSkipped(task.name);
        }
    }

    private _getDependentTasks(name: string): Task<TId>[] {
        const dependents: Task<TId>[] = [];
        for (const task of _.values(this._tasks)) {
            if (name in task.predecessors) {
                dependents.push(task);
            }
        }
        return dependents;
    }

    private _finishWithSuccess(): void {
        if (!this._isRunning) {
            return;
        }
        const cb = this._resolveCb!;
        this._logger.info('Processing completed. %s', this._id);
        this.close();
        cb();
    }

    private _finishWithFailure(): void {
        if (!this._isRunning) {
            return;
        }
        const cb = this._rejectCb!;
        this._logger.error('Processing failed. %s', this._id);
        this.close();
        cb('One or more tasks failed.');
    }

    debugOutputIncompleteTasks(): void {
        const tasksByState = this.tasksByState;
        const states: TaskState[] = [TaskState.Error, TaskState.Unqualified, TaskState.Skipped];
        for (const state of states) {
            const tasks = tasksByState[state];
            this._logger.info('%s Tasks. Count = %s', state, tasks.length);
            for (const x of tasks) {
                this._logger.info(' - %s', x.name);
            }
        }
    }
}
