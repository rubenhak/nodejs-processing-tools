const Promise = require('the-promise');
const _ = require('lodash');
const uuid = require('uuid/v4');

const DependencyProcessor = require('../dependency-processor');
const ConfigDeltaItem = require('./delta-item');

class DeltaProcessor
{
    constructor(logger, currentConfig, desiredConfig)
    {
        this._currentConfig = currentConfig;
        this._desiredConfig = desiredConfig;
        this._logger = logger;
        this._deltaConfig = this._desiredConfig.produceDelta(this._currentConfig);
        this._outputDeltaConfig();
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
                var tasksByState = processor.tasksByState;

                var taskCounter = _.mapValues(tasksByState, x => x.length);

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

        this._logger.info('Setup delete item: %s', item.dn);

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
        this._logger.info('Setup create item: %s', item.dn);

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

        this._logger.info('process: ' + dn);

        if (!dn) {
            return true;
        }

        var dnInfo = this._currentConfig.meta.breakDn(dn);
        var meta = dnInfo.meta;

        return Promise.resolve()
            .then(() => {
                if (meta._autoConfig) {

                    var currentItem = this._currentConfig.findDn(dn);
                    var desiredItem = this._desiredConfig.findDn(dn);
                    if (desiredItem) {
                        this._logger.info('process: %s BEGIN AUTOCONFIG. Action: %s', dn, itemId.action);

                        return Promise.resolve(desiredItem.performAutoConfig(itemId.action))
                            .then(canContinue => {
                                if (!canContinue) {
                                    this._logger.info('process: %s END AUTOCONFIG :: CANNOT CONTINUE. Action: %s.', dn, itemId.action);
                                    return false;
                                }

                                if (currentItem) {
                                    var itemDelta = desiredItem.produceDelta(currentItem);
                                    if (itemDelta) {
                                        this._deltaConfig[dn] = new ConfigDeltaItem(desiredItem, 'update', itemDelta);
                                        this._logger.info('process: %s to be updated after AUTOCONFIG. Action: %s.', dn, itemId.action);
                                        this._deltaConfig[dn].output();
                                        if (desiredItem.meta._onUpdateRecreateCb)
                                        {
                                            if (desiredItem.meta._onUpdateRecreateCb(this._deltaConfig[dn]))
                                            {
                                                this._logger.info('process: %s Marking Recreatable During AUTOCONFIG. Action: %s.', dn, itemId.action);
                                                this._desiredConfig.markItemRecreateInDelta(this._deltaConfig, desiredItem);
                                            }
                                        }
                                    } else {
                                        this._logger.info('process: %s no change after AUTOCONFIG. Action: %s.', dn, itemId.action);
                                        delete this._deltaConfig[dn];
                                    }
                                } else {
                                    this._deltaConfig[dn] = new ConfigDeltaItem(desiredItem, 'create');
                                    this._logger.info('process: %s to be created after AUTOCONFIG. Action: %s.', dn, itemId.action);
                                    this._deltaConfig[dn].output();
                                }

                                this._logger.info('process: %s END AUTOCONFIG. Action: %s.', dn, itemId.action);
                                return canContinue;
                            });
                    }
                }

                return true;
            })
            .then(canContinue => {
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
                this._logger.info('process: ' + dn + ' :: end');
                return canContinue;
            });
    }

    _processDeltaCreate(deltaItem, meta)
    {
        if (deltaItem.status == 'create' || deltaItem.status == 'recreate') {
            this._logger.info('Process Delta Create %s', deltaItem.dn);

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
                .then(() => {
                    var relations = deltaItem.item.relations;
                    return Promise.serial(relations, relation => this._processDeltaRelationCreate(deltaItem, relation.targetDn));
                })
                then(() => true);
                ;
        }
        else if (deltaItem.status == 'update')
        {
            this._logger.info('Process Delta Update %s', deltaItem.dn);

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
                then(() => true);
                ;
        }

        return true;
    }

    _processDeltaRelationCreate(deltaItem, targetDn)
    {
        this._logger.info('Creating relation %s => %s...', deltaItem.item.dn, targetDn);

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
                this._logger.info('Relation %s => %s is created. Result:', deltaItem.item.dn, targetDn, updated);
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
        this._logger.info('Deleting relation %s => %s...', deltaItem.item.dn, targetDn);
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
        this._logger.info('Refreshing %s...', dn);
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
            this._logger.info('Process Delta Delete %s', deltaItem.dn);

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
            this._logger.info('Process Delta Delete Updated Relations %s', deltaItem.dn);

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

    _outputDeltaConfig()
    {
        this._logger.info('******************************');
        this._logger.info('******************************');
        this._logger.info('******** DELTA CONFIG ********');
        this._logger.info('******************************');
        for(var item of _.values(this._deltaConfig))
        {
            this._logger.info('Item %s, status: %s', item.dn, item.status);
            if (item.status == 'update') {
                this._logger.info('        delta:%s', '', item.delta);
            } else if (item.status == 'create') {
                this._logger.info('        config:%s', '', item.config);
                //this._logger.info('        naming:%s', '', item.item.naming);
            }
        }
    }

}

module.exports = DeltaProcessor;