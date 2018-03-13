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
        if (this._logger) {
            this._logger.info('Health Check Started...');
        }

        var tasksByState = this.tasksByState;

        for (var taskStatus of _.keys(tasksByState))
        {
            if (this._logger) {
                this._logger.info('Tasks %s. Count=%s.', taskStatus, tasksByState[taskStatus].length);
            }
        }

        for (var taskStatus of _.keys(tasksByState))
        {
            if (this._logger) {
                this._logger.info('**** %s Tasks. Count=%s.', taskStatus, tasksByState[taskStatus].length);
                for(var task of _.orderBy(tasksByState[taskStatus], x => x.dn)) {
                    this._logger.info('  -> %s is %s...', task.name, taskStatus);
                }
            }
        }

        if (this._logger) {
            this._logger.info('Health check complete.');
        }

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
        }
        return this._tasks[name];
    }

    process()
    {
        if (this._logger) {
            this._logger.info('Processing started. %s', this._id);
        }

        this._isStepScheduled = false;
        this._isRunning = true;
        this._setupHealthChecker();
        return new Promise((resolve, reject) => {
            this._resolveCb = resolve;
            this._rejectCb = reject;
            this._step();
        });
    }

    close()
    {
        if (!this._isRunning) {
            return;
        }
        this._isRunning = false;

        if (this._logger) {
            this._logger.info('Processing stopped. %s', this._id);
        }
        this._resolveCb = null;
        this._rejectCb = null;
        this._clearHealthChecker();
    }

    _step()
    {
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

            var hasError = false;
            var hasIdle = false;
            var hasRunning = false;
            for(var task of _.values(this._tasks))
            {
                if (task.state == TaskState.Idle) {
                    hasIdle = true;
                }
                if (task.state == TaskState.Running || task.state == TaskState.WaitingFinish) {
                    hasRunning = true;
                }
                if (task.state == TaskState.Error) {
                    hasError = true;
                }
            }

            if (hasError) {
                this._finishWithFailure();
                return;
            }

            if (!hasIdle && !hasRunning) {
                this._finishWithSuccess();
                return;
            }

            var tasksToRun = [];
            var tasksToSkip = [];
            for(var task of _.values(this._tasks))
            {
                if (this._canRunTask(task)) {
                    if (this._checkIfTaskPreRun(task)) {
                        tasksToRun.push(task);
                    } else {
                        tasksToSkip.push(task);
                    }
                }
            }

            if (tasksToSkip.length > 0)
            {
                for(var task of tasksToSkip)
                {
                    this._markUnqualified(task);
                }

            }
            else
            {
                for(var task of tasksToRun)
                {
                    if (this._canRunTask(task)) {
                        this._runTask(task);
                    }
                }
            }

            this._step();

        } catch (e) {
            if (this._logger) {
                this._logger.error('Error in _step.%s ', this._id, e);
                this._logger.exception(e);
            } else {
                console.log(e);
            }

            this._step();
        } finally {
            this._isInsideStep = false;
        }
    }

    _markUnqualified(task)
    {
        task.state = TaskState.Unqualified;
        if (this._logger) {
            this._logger.info('Task %s is not qualified.', task.name);
        }
        this._markDependentsSkipped(task.name);
    }

    _checkIfTaskPreRun(task)
    {
        if (task.preRunCheckerCb) {
            if (this._logger) {
                this._logger.info('Checking pre run conditions for %s ...', task.name);
            }
            var result = task.preRunCheckerCb();
            this._logger.info('Task %s prerun check result = %s.', task.name, result);
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
        if (!task.id) {
            this._logger.warn('Task %s does not have id...', task.name);
            task.state = TaskState.Complete;
            this._step();
            return;
        }
        if (this._logger) {
            this._logger.info('Running %s...', task.name);
        }
        task.state = TaskState.Running;
        this._markTaskLabel(task);

        Promise.resolve(this._handler(task.id))
            .then(canContinue => {
                if (canContinue) {
                    if (this._logger) {
                        this._logger.info('%s completed.', task.name);
                    }
                    return this._runPostTaskFinish(task);
                } else {
                    if (this._logger) {
                        this._logger.info('%s completed but unqualified.', task.name);
                    }
                    this._markUnqualified(task);
                    this._step();
                }
            })
            .catch(error => {
                if (this._logger) {
                    this._logger.error('%s failed. Error', task.name, error);
                } else {
                    console.log(error);
                }
                task.state = TaskState.Error;
                this._unmarkTaskLabel(task);
                this._step();
            });
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
                if (this._logger) {
                    this._logger.info('Running %s CompletionChecker. CalledFromTimer=%s...', task.name, calledFromTimer);
                }

                var completionResult = task.completionCheckerCb();
                if (this._logger) {
                    this._logger.info('Task %s completion result: ', task.name, completionResult);
                }

                if (!completionResult)
                {
                    this._markUnqualified(task);
                }
                else
                {
                    if (completionResult.ready)
                    {
                        task.state = TaskState.Complete;
                        this._unmarkTaskLabel(task);
                        this._step();
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
                task.state = TaskState.Complete;
                this._unmarkTaskLabel(task);
                this._step();
            }
        } catch (e) {
            logger.error('Exception inside _checkTaskCompletion', e);
            logger.exception(e);
        }
    }

    _markTaskLabel(task)
    {
        for(var label of task.labels)
        {
            if (this._logger) {
                this._logger.info('Marking task %s label %s...', task.name, label);
            }

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
            if (this._logger) {
                this._logger.info('Clearing task %s label %s...', task.name, label);
            }

            if (label in this._currentLabels) {
                var dict = this._currentLabels[label];
                delete dict[task.name];
                if (_.keys(dict).length == 0) {
                    delete this._currentLabels[label];
                }
            }
        }
    }

    _canRunTask(task)
    {
        if (task.state != TaskState.Idle) {
            return false;
        }
        for(var predecessorName of _.keys(task.predecessors))
        {
            var predecessor = this._tasks[predecessorName];
            if (predecessor) {
                if (predecessor.state != TaskState.Complete) {
                    return false;
                }
            }
        }
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
                task.state = TaskState.Skipped;

                if (this._logger) {
                    this._logger.info('Skipped task %s.', task.name);
                }
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
        if (this._logger) {
            this._logger.info('Processing completed. %s', this._id);
        }
        this.close();
        cb();
    }

    _finishWithFailure()
    {
        if (!this._isRunning) {
            return;
        }
        var cb = this._rejectCb;
        if (this._logger) {
            this._logger.error('Processing failed. %s', this._id);
        }
        this.close();
        cb('One or more tasks failed.');
    }
}

module.exports = DependencyProcessor;
