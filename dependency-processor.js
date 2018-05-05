const _ = require('lodash');
const Promise = require('the-promise');
const uuid = require('uuid/v4');

const TaskState = {
    Idle: 'Idle',
    Running: 'Running',
    WaitingFinish: 'WaitingFinish',
    Complete: 'Complete',
    Error: 'Error',
    Unqualified: 'Unqualified',
    Skipped: 'Skipped'
}

class DependencyProcessor
{
    constructor(logger, id, handler)
    {
        this._handler = handler;
        this._logger = logger;
        this._tasks = {};
        this._idleTasks = {};
        this._failedTasks = {};
        this._runningTasks = {};
        this._currentLabels = {};
        this._isRunning = false;
        this._id = id;
        this._isInsideStep = false;
    }

    _clearHealthChecker()
    {
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }
    }

    _setupHealthChecker()
    {
        this._clearHealthChecker();
        this._healthTimer = setInterval(() => this._processHealthCheck(), 30 * 1000);
    }

    get tasksByState() {
        var tasksByState = _
            .chain(this._tasks)
            .values()
            .groupBy(x => x.state)
            .value();
        for (var state of _.keys(TaskState)) {
            if (!(state in tasksByState)) {
                tasksByState[state] = [];
            }
        }
        return tasksByState;
    }

    _processHealthCheck()
    {
        this._logger.info('Health Check Started...');

        var tasksByState = this.tasksByState;

        for (var taskStatus of _.keys(tasksByState))
        {
            this._logger.info('Tasks %s. Count=%s.', taskStatus, tasksByState[taskStatus].length);
        }

        for (var taskStatus of _.keys(tasksByState))
        {
            this._logger.info('**** %s Tasks. Count=%s.', taskStatus, tasksByState[taskStatus].length);
            for(var task of _.orderBy(tasksByState[taskStatus], x => x.dn)) {
                this._logger.info('  -> %s is %s...', task.name, taskStatus);
                this._logger.info('     predecessors:', _.keys(task.predecessors));

            }
        }

        this._logger.info('Health check complete.');
    }

    addTask(id)
    {
        var name = JSON.stringify(id);
        var task = this._setupTask(name);
        task.id = id;
    }

    setDependency(id, predecessorId)
    {
        var name = JSON.stringify(id);
        var predecessorName = JSON.stringify(predecessorId);
        var task = this._setupTask(name);
        task.predecessors[predecessorName] = true;
    }

    setLabel(id, label)
    {
        var name = JSON.stringify(id);
        var task = this._setupTask(name);
        task.labels.push(label);
    }

    setCompletionChecker(id, cb)
    {
        var name = JSON.stringify(id);
        var task = this._setupTask(name);
        task.completionCheckerCb = cb;
    }

    setPreRunChecker(id, cb)
    {
        var name = JSON.stringify(id);
        var task = this._setupTask(name);
        task.preRunCheckerCb = cb;
    }

    setNonConcurrentLabels(id, labels)
    {
        var name = JSON.stringify(id);
        var task = this._setupTask(name);
        for(var label of labels) {
            task.nonConcurrentLabels.push(label);
        }
    }

    _setupTask(name) {
        if (!(name in this._tasks)) {
            this._tasks[name] = {
                name: name,
                state: TaskState.Idle,
                predecessors: {},
                labels: [],
                nonConcurrentLabels: [],
                completionCheckerCb: null
            };

            this._idleTasks[name] = this._tasks[name];
        }
        return this._tasks[name];
    }

    process()
    {
        this._logger.info('Processing started. %s', this._id);

        this._isStepScheduled = false;
        this._isRunning = true;
        this._setupHealthChecker();
        return new Promise((resolve, reject) => {
            this._resolveCb = resolve;
            this._rejectCb = reject;
            this._step('process');
        });
    }

    close()
    {
        if (!this._isRunning) {
            return;
        }
        this._isRunning = false;

        this._logger.info('Processing stopped. %s', this._id);
        this._resolveCb = null;
        this._rejectCb = null;
        this._clearHealthChecker();
    }

    _step(callerName)
    {
        this._logger.verbose('[_step] begin. callerName: %s', callerName);
        if (this._isStepScheduled) {
            return;
        }
        this._isStepScheduled = true;
        setImmediate(() => {
            this._runStep();
        });
    }

    _runStep()
    {
        this._logger.verbose('[_runStep] begin. isrunning: %s', this._isRunning);
        if (!this._isRunning) {
            return;
        }

        this._isStepScheduled = false;
        this._setupHealthChecker();

        try {
            if (this._isInsideStep){
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

            if ((_.keys(this._idleTasks).length == 0) && (_.keys(this._runningTasks).length == 0)) {
                this._finishWithSuccess();
                return;
            }

            var readyToRunTasks = _.values(this._idleTasks).filter(x => this._arePredecessorsCompleted(x));
            this._logger.info('[_runStep] readyToRunTasks: %s', readyToRunTasks.length);
            var nonConcurrentTasksToRun = readyToRunTasks.filter(x => this._areConcurrentLabelsAvailable(x));
            this._logger.info('[_runStep] nonConcurrentTasksToRun: %s', nonConcurrentTasksToRun.length);

            var tasksToSkip = nonConcurrentTasksToRun.filter(x => !this._checkIfTaskPreRun(x));
            if (tasksToSkip.length > 0)
            {
                this._logger.info('[_runStep] tasksToSkip: %s', tasksToSkip.length );
                for(var task of tasksToSkip)
                {
                    this._markUnqualified(task);
                }
                this._step('_runStep::afterTaskSkip');
            }
            else
            {
                this._logger.info('[_runStep] tasksToRun: %s', nonConcurrentTasksToRun.length );
                for(var task of nonConcurrentTasksToRun)
                {
                    var startedTasks = false;
                    if (this._areConcurrentLabelsAvailable(task))
                    {
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

    _markUnqualified(task)
    {
        this._markFinalState(task, TaskState.Unqualified, '_markUnqualified');
        this._markDependentsSkipped(task.name);
    }

    _checkIfTaskPreRun(task)
    {
        if (task.preRunCheckerCb) {
            this._logger.verbose('Checking pre run conditions for %s ...', task.name);
            var result = task.preRunCheckerCb();
            this._logger.verbose('Task %s prerun check result = %s.', task.name, result);
            if (result) {
                return true;
            } else {
                return false;
            }
        }
        return true;
    }

    _runTask(task)
    {
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
            .then(canContinue => {
                if (canContinue) {
                    this._logger.info('Completed: %s', task.name);
                    return this._runPostTaskFinish(task);
                } else {
                    this._logger.info('Unqualified: %s', task.name);
                    this._markUnqualified(task);
                    this._step('_runTask::unqualified');
                }
            })
            .catch(error => {
                this._logger.error('%s failed. Error', task.name, error);
                this._failedTasks[task.name] = task;
                this._markFinalState(task, TaskState.Error, '_runTask::catch');
            });
    }

    _markFinalState(task, state, reason)
    {
        this._logger.info('Task %s => %s...', task.name, state);

        delete this._idleTasks[task.name];
        delete this._runningTasks[task.name];
        task.state = state;
        this._unmarkTaskLabel(task);
        this._step(reason);
    }

    _runPostTaskFinish(task)
    {
        task.state = TaskState.WaitingFinish;
        return this._checkTaskCompletion(task, false);
    }

    _checkTaskCompletion(task, calledFromTimer)
    {
        try {
            if (task.completionCheckerCb) {
                this._logger.info('Running %s CompletionChecker. CalledFromTimer=%s...', task.name, calledFromTimer);
                var completionResult = task.completionCheckerCb();
                this._logger.info('Task %s completion result: ', task.name, completionResult);
                if (!completionResult)
                {
                    this._markUnqualified(task);
                }
                else
                {
                    if (completionResult.ready)
                    {
                        this._markTaskComplete(task);
                    }
                    else
                    {
                        if (completionResult.retry)
                        {
                            return Promise.timeout(completionResult.timeout * 1000)
                                .then(() => this._checkTaskCompletion(task, true));
                        }
                        else
                        {
                            this._markUnqualified(task);
                        }
                    }
                }
            }
            else
            {
                this._markTaskComplete(task);
            }
        } catch (e) {
            logger.error('Exception inside _checkTaskCompletion', e);
            logger.exception(e);
        }
    }

    _markTaskComplete(task)
    {
        this._markFinalState(task, TaskState.Complete, '_markTaskComplete');
    }

    _markTaskLabel(task)
    {
        for(var label of task.labels)
        {
            this._logger.info('Marking task %s label %s...', task.name, label);

            if (!(label in this._currentLabels)) {
                this._currentLabels[label] = {};
            }
            this._currentLabels[label][task.name] = true;
        }
    }

    _unmarkTaskLabel(task)
    {
        for(var label of task.labels)
        {
            this._logger.info('Clearing task %s label %s...', task.name, label);

            if (label in this._currentLabels) {
                var dict = this._currentLabels[label];
                delete dict[task.name];
                if (_.keys(dict).length == 0) {
                    delete this._currentLabels[label];
                }
            }
        }
    }

    _arePredecessorsCompleted(task)
    {
        for(var predecessorName of _.keys(task.predecessors))
        {
            var predecessor = this._tasks[predecessorName];
            if (predecessor) {
                if (predecessor.state != TaskState.Complete) {
                    return false;
                }
            }
        }
        return true;
    }

    _areConcurrentLabelsAvailable(task)
    {
        for(var label of task.nonConcurrentLabels) {
            if (label in this._currentLabels) {
                return false;
            }
        }
        return true;
    }

    _markDependentsSkipped(name)
    {
        var dependents = this._getDependentTasks(name);

        var others = [];
        for (var task of dependents) {
            if (task.state == TaskState.Idle) {
                others.push(task);
                this._markFinalState(task, TaskState.Skipped, '_markDependentsSkipped');

                this._logger.info('Skipped task %s.', task.name);
            }
        }
        for (var task of others) {
            this._markDependentsSkipped(task.name)
        }
    }

    _getDependentTasks(name)
    {
        var dependents = [];
        for(var task of _.values(this._tasks))
        {
            if (name in task.predecessors) {
                dependents.push(task);
            }
        }
        return dependents;
    }

    _finishWithSuccess()
    {
        if (!this._isRunning) {
            return;
        }
        var cb = this._resolveCb;
        this._logger.info('Processing completed. %s', this._id);
        this.close();
        cb();
    }

    _finishWithFailure()
    {
        if (!this._isRunning) {
            return;
        }
        var cb = this._rejectCb;
        this._logger.error('Processing failed. %s', this._id);
        this.close();
        cb('One or more tasks failed.');
    }
}

module.exports = DependencyProcessor;
