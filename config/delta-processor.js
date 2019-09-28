const Promise = require('the-promise');
const _ = require('the-lodash');
const uuid = require('uuid/v4');

const DependencyProcessor = require('../dependency-processor');

class DeltaProcessor
{
    constructor(logger, currentConfig, desiredConfig)
    {
        this._currentConfig = currentConfig;
        this._desiredConfig = desiredConfig;
        this._logger = logger;
        this._deltaConfig = this._desiredConfig.produceDelta(this._currentConfig);
        this._id = uuid();
        this._logger.info('Created delta %s', this._id);
    }

    get deltaConfig() {
        return this._deltaConfig;
    }

    process()
    {
        return this._processDelta();
    }

    _processDelta()
    {
        this._logger.info('Processing delta %s...', this._id);

        var processor = new DependencyProcessor(this._logger.sublogger('Processor'), this._id, x => this._processDeltaItem(x));

        var breakerId = { action: 'breaker' };
        processor.addTask(breakerId);

        var processResult = {};

        return Promise.resolve()
            .then(() => this._logger.info('Accepting items... %s', this._id))
            .then(() => Promise.serial(_.values(this._currentConfig._sections), section => {
                return Promise.serial(section.items, item => this._setupDeleteItem(processor, item, breakerId));
            }))
            .then(() => Promise.serial(_.values(this._desiredConfig._sections), section => {
                return Promise.serial(section.items, item => this._setupCreateItem(processor, item, breakerId));
            }))
            .then(() => this._logger.info('Processing... %s', this._id))
            .then(() => processor.process())
            .then(() => this._logger.info('Processing completed. %s', this._id))
            .catch(error => {
                this._logger.error('Processing failed. %s', this._id);
                this._logger.error('Processing failed. %s', this._id, error);
                this._logger.exception(error);
                processResult.hasError = true;
                processResult.error = error;
            })
            .then(() => {
                processor.debugOutputIncompleteTasks();

                var taskCounter = _.mapValues(processor.tasksByState, x => x.length);

                processResult.taskErrors = processor.taskErrors;
                processResult.failedTaskCount = taskCounter['Error'];
                processResult.skippedTaskCount = taskCounter['Unqualified'] + taskCounter['Skipped'];
                processResult.runningTaskCount = taskCounter['Running'] + taskCounter['WaitingFinish'];
                processResult.idleTaskCount = taskCounter['Idle'];
                processResult.taskCounter = taskCounter;

                this._logger.info('Processing summary. %s', this._id, processResult);

                processor.close();
                return processResult;
            });
    }

    _setupDeleteItem(processor, item, breakerId)
    {
        var itemId = { dn: item.dn, action: 'delete' };

        this._logger.verbose('Setup delete item: %s', item.dn);

        processor.addTask(itemId);
        if (item.taskLabels) {
            for(var label of item.taskLabels) {
                processor.setLabel(itemId, label);
            }
        }
        if (item.nonConcurrentLabels) {
            processor.setNonConcurrentLabels(itemId, item.nonConcurrentLabels);
        }
        processor.setDependency(breakerId, itemId);
        for (var relation of item.relations)
        {
            if (!relation.shouldIgnoreDependency) {
                var predecessorId = { dn: relation.targetDn, action: 'delete' };
                processor.setDependency(predecessorId, itemId);
            }
        }
    }

    _setupCreateItem(processor, item, breakerId)
    {
        var itemId = { dn: item.dn, action: 'create' };
        this._logger.verbose('Setup create item: %s', item.dn);

        processor.addTask(itemId);
        if (item.taskLabels) {
            for(var label of item.taskLabels) {
                processor.setLabel(itemId, label);
            }
        }
        if (item.nonConcurrentLabels) {
            processor.setNonConcurrentLabels(itemId, item.nonConcurrentLabels);
        }
        processor.setDependency(itemId, breakerId);
        for (var relation of item.relations)
        {
            if (!relation.shouldIgnoreDependency) {
                var predecessorId = { dn: relation.targetDn, action: 'create' };
                processor.setDependency(itemId, predecessorId);
            }
        }
        if (item.preRunCheckerCb)
        {
            processor.setPreRunChecker(itemId, item.preRunCheckerCb);
        }
        if (item.completionCheckerCb)
        {
            processor.setCompletionChecker(itemId, item.completionCheckerCb);
        }
    }

    _processDeltaItem(itemId)
    {
        var dn = itemId.dn;

        this._logger.verbose('process: ' + dn);

        if (!dn) {
            return true;
        }

        var dnInfo = this._currentConfig.meta.breakDn(dn);
        var meta = dnInfo.meta;

        return Promise.resolve()
            .then(() => this._checkDependencies(itemId, dn, meta))
            .then(canContinue => {
                this._logger.verbose('[_processDeltaItem]: %s. action=%s. dependencies canContinue=%s', dn, itemId.action, canContinue);
                if (!canContinue) {
                    return false;
                }

                return this._processAutoConfig(itemId, dn, meta);
            })
            .then(canContinue => {
                this._logger.verbose('[_processDeltaItem]: %s. action=%s. autoconfig canContinue=%s', dn, itemId.action, canContinue);
                if (!canContinue) {
                    return false;
                }

                if (dn in this._deltaConfig) {
                    var deltaItem = this._deltaConfig[dn];
                    if (itemId.action == 'create') {
                        return this._processDeltaCreate(deltaItem, meta);
                    } else if (itemId.action == 'delete') {
                        return this._processDeltaDelete(deltaItem, meta);
                    }
                }
                return true;
            })
            .then(canContinue => {
                this._logger.verbose('process: ' + dn + ' :: end');
                return canContinue;
            });
    }

    _checkDependencies(itemId, dn, meta)
    {
        this._logger.verbose('[_checkDependencies]: %s', dn, itemId.action);

        if (itemId.action != "create") {
            return true;
        }

        var deltaItem = this._deltaConfig[dn];
        if (!deltaItem) {
            return true;
        }

        for(var relation of deltaItem.item.relations)
        {
            var targetItem = relation.targetItem;
            if (!targetItem) {
                this._logger.info('[_checkDependencies] missing dependency %s => %s', dn, relations.targetDn);
                return false;
            }
            var resolvedItem = targetItem.resolved;
            if (!resolvedItem) {
                this._logger.info('[_checkDependencies] missing resolved %s => %s', dn, resolvedItem.dn);
                return false;
            }
            if (!resolvedItem.isReady) {
                this._logger.info('[_checkDependencies] dependency not ready %s => %s', dn, resolvedItem.dn);
                return false;
            }
        }

        return true;
    }

    _processAutoConfig(itemId, dn, meta)
    {
        this._logger.verbose('[_processAutoConfig]: %s', dn, itemId.action);

        if (itemId.action != "create") {
            return true;
        }

        if (meta._autoConfig)
        {
            var currentItem = this._currentConfig.findDn(dn);
            var desiredItem = this._desiredConfig.findDn(dn);
            if (desiredItem) {
                this._logger.verbose('process: %s BEGIN AUTOCONFIG. Action: %s', dn, itemId.action);

                return Promise.resolve(desiredItem.performAutoConfig(itemId.action))
                    .then(canContinue => {
                        if (!canContinue) {
                            this._logger.verbose('process: %s END AUTOCONFIG :: CANNOT CONTINUE. Action: %s.', dn, itemId.action);
                            return false;
                        }

                        if (currentItem) {
                            var itemDelta = desiredItem.produceDelta(currentItem);
                            if (itemDelta) {
                                desiredItem.addToDeltaDict(this._deltaConfig, 'update', itemDelta);
                                this._logger.verbose('process: %s to be updated after AUTOCONFIG. Action: %s.', dn, itemId.action);
                                this._deltaConfig[dn].output();
                                if (desiredItem.meta._onUpdateRecreateCb)
                                {
                                    if (desiredItem.meta._onUpdateRecreateCb(this._deltaConfig[dn]))
                                    {
                                        this._logger.verbose('process: %s Marking Recreatable During AUTOCONFIG. Action: %s.', dn, itemId.action);
                                        this._desiredConfig.markItemRecreateInDelta(this._deltaConfig, desiredItem);
                                    }
                                }
                            } else {
                                this._logger.verbose('process: %s AUTOCONFIG returned none. Action: %s.', dn, itemId.action);
                                if (dn in this._deltaConfig)
                                {
                                    if (this._deltaConfig[dn].status != 'recreate')
                                    {
                                        this._logger.verbose('process: %s no change after AUTOCONFIG. Action: %s.', dn, itemId.action);
                                        delete this._deltaConfig[dn];
                                    }
                                    else
                                    {
                                        this._logger.verbose('process: %s no change after AUTOCONFIG. But keeping recreate. Action: %s.', dn, itemId.action);
                                    }
                                }
                            }
                        } else {
                            desiredItem.addToDeltaDict(this._deltaConfig, 'create');
                            this._logger.verbose('process: %s to be created after AUTOCONFIG. Action: %s.', dn, itemId.action);
                            this._deltaConfig[dn].output();
                        }

                        this._logger.verbose('process: %s END AUTOCONFIG. Action: %s.', dn, itemId.action);
                        return true;
                    });
            }
        }

        return true;
    }

    _processDeltaCreate(deltaItem, meta)
    {
        if (deltaItem.status == 'create' || deltaItem.status == 'recreate') {
            this._logger.verbose('Process Delta Create %s', deltaItem.dn);

            var newlyCreatedItem = null;
            return Promise.resolve()
                .then(() => {
                    if (meta._onCreate) {
                        return Promise.resolve(meta.create(deltaItem))
                            .then(obj => {
                                if (!obj) {
                                    this._logger.error('None returned from %s::_onCreate', deltaItem.dn);
                                    return;
                                }
                                return deltaItem.resolutionConfig.section(meta.name).mergeItem(obj, deltaItem.item.runtime);
                            });
                    }
                })
                .then(item => {
                    newlyCreatedItem = item;
                    var relations = deltaItem.item.relations;
                    return Promise.serial(relations, relation => this._processDeltaRelationCreate(deltaItem, relation.targetDn));
                })
                .then(() => {
                    if (meta._onPostCreate) {
                        if (newlyCreatedItem) {
                            return meta._onPostCreate(newlyCreatedItem);
                        }
                    }
                })
                .then(() => true);
                ;
        }
        else if (deltaItem.status == 'update')
        {
            this._logger.verbose('Process Delta Update %s', deltaItem.dn);

            return Promise.resolve()
                .then(() => {
                    if (meta._onUpdate) {
                        return Promise.resolve(meta.update(deltaItem))
                            .then(obj => {
                                return this._refreshDeltaItem(deltaItem.item.root, deltaItem.dn);
                            });
                    }
                })
                .then(() => {
                    var relations = deltaItem.delta.relations.filter(x => (x.state == 'update'));
                    return Promise.serial(relations, relation => this._processDeltaRelationDelete(deltaItem, relation.relation, relation.runtime));
                })
                .then(() => {
                    var relations = deltaItem.delta.relations.filter(x => (x.state == 'create' || x.state == 'update'));
                    return Promise.serial(relations, relation => this._processDeltaRelationCreate(deltaItem, relation.relation));
                })
                .then(() => true);
                ;
        }

        return true;
    }

    _processDeltaRelationCreate(deltaItem, targetDn)
    {
        this._logger.verbose('Creating relation %s => %s...', deltaItem.item.dn, targetDn);

        var target = deltaItem.item.root.findDn(targetDn);
        if (!target) {
            this._logger.error('[_processDeltaRelationCreate] Could not fetch target %s for %s', targetDn, deltaItem.item.dn);
            return;
        }
        return deltaItem.item.meta.relationCreate(deltaItem.item, target)
            .then(updated =>  {
                if (!updated) {
                    return updated;
                }
                this._logger.verbose('Relation %s => %s is created. Result:', deltaItem.item.dn, targetDn, updated);
                return Promise.resolve()
                    .then(() => this._refreshDeltaItem(deltaItem.item.root, deltaItem.dn))
                    .then(() => this._refreshDeltaItem(target.root, target.dn))
                    .then(() => updated)
                    ;
            })
            .then(updated => {
                if (updated)
                {
                    target = deltaItem.item.root.findDn(targetDn);
                    return deltaItem.item.meta.postRelationCreate(deltaItem.item, target);
                }
            });
    }

    _processDeltaRelationDelete(deltaItem, targetDn, runtime)
    {
        this._logger.verbose('Deleting relation %s => %s...', deltaItem.item.dn, targetDn);
        var target = deltaItem.item.root.resolveDn(targetDn);
        if (!target) {
            this._logger.error('[_processDeltaRelationDelete] Could not fetch target %s for %s', targetDn, deltaItem.item.dn);
            return;
        }
        return deltaItem.item.meta.relationDelete(deltaItem.item, target, runtime)
            .then(updated =>  {
                if (!updated) {
                    return;
                }
                return Promise.resolve()
                    .then(() => this._refreshDeltaItem(deltaItem.item.root, deltaItem.dn))
                    .then(() => this._refreshDeltaItem(target.root, target.dn));
            });
    }

    _refreshDeltaItem(root, dn)
    {
        this._logger.verbose('Refreshing %s...', dn);
        var item = root.resolveDn(dn);
        if (!item) {
            this._logger.error('[_refreshDeltaItem] Could not fetch item for %s', dn);
            return;
        }
        return item.refresh();
    }

    _processDeltaDelete(deltaItem, meta)
    {
        if (deltaItem.status == 'delete' || deltaItem.status == 'recreate') {
            this._logger.verbose('Process Delta Delete %s', deltaItem.dn);

            return Promise.resolve()
                .then(() => {
                    var relations = deltaItem.item.relations;
                    return Promise.serial(relations, relation => this._processDeltaRelationDelete(deltaItem, relation.targetDn, relation.runtime));
                })
                .then(() => {
                    if (meta._onDelete) {
                        return Promise.resolve(meta._onDelete(deltaItem))
                        .then(obj => {
                            deltaItem.resolutionConfig.section(meta.name).remove(deltaItem.dn);
                        });
                    }
                })
                .then(() => true)
                ;
        } else if (deltaItem.status == 'update') {
            this._logger.verbose('Process Delta Delete Updated Relations %s', deltaItem.dn);

            return Promise.resolve()
                .then(() => {
                    var relations = deltaItem.delta.relations.filter(x => (x.state == 'delete'));
                    return Promise.serial(relations, relation => this._processDeltaRelationDelete(deltaItem, relation.relation, relation.runtime));
                })
                .then(() => true)
                ;
        }

        return true;
    }

}

module.exports = DeltaProcessor;
