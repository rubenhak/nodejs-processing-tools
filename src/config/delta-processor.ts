import _ from 'the-lodash';
import { MyPromise } from 'the-promise';
import { v4 as uuid } from 'uuid';

import { DependencyProcessor, TaskErrorInfo, TaskState } from '../dependency-processor';
import { Config } from './config';
import { ConfigDeltaItem, DeltaDict } from './delta-item';
import { DeltaItemStatus, DeltaState, DeltaTaskId, TaskAction } from './types';
import type { ConfigItem } from './item';
import type { ConfigSectionMeta } from './meta/section';
import { ILogger } from '../logger';

export interface DeltaProcessResult {
    hasError?: boolean;
    error?: any;
    taskErrors: TaskErrorInfo<DeltaTaskId>[];
    failedTaskCount: number;
    skippedTaskCount: number;
    runningTaskCount: number;
    idleTaskCount: number;
    taskCounter: Record<string, number>;
}

export class DeltaProcessor {
    private _currentConfig: Config;
    private _desiredConfig: Config;
    private _logger: ILogger;
    private _deltaConfig: DeltaDict;
    private _id: string;

    constructor(logger: ILogger, currentConfig: Config, desiredConfig: Config) {
        this._currentConfig = currentConfig;
        this._desiredConfig = desiredConfig;
        this._logger = logger;
        this._deltaConfig = this._desiredConfig.produceDelta(this._currentConfig);
        this._id = uuid();
        this._logger.info('Created delta %s', this._id);
    }

    get id(): string {
        return this._id;
    }

    get deltaConfig(): DeltaDict {
        return this._deltaConfig;
    }

    process(): Promise<DeltaProcessResult> {
        return this._processDelta();
    }

    private _processDelta(): Promise<DeltaProcessResult> {
        this._logger.info('Processing delta %s...', this._id);

        const processor = new DependencyProcessor<DeltaTaskId>(this._logger.sublogger('Processor'), this._id, (x) =>
            this._processDeltaItem(x),
        );

        const breakerId: DeltaTaskId = { action: TaskAction.Breaker };
        processor.addTask(breakerId);

        const processResult: DeltaProcessResult = {
            taskErrors: [],
            failedTaskCount: 0,
            skippedTaskCount: 0,
            runningTaskCount: 0,
            idleTaskCount: 0,
            taskCounter: {},
        };

        return Promise.resolve()
            .then(() => this._logger.info('Accepting items... %s', this._id))
            .then(() =>
                MyPromise.serial(_.values(this._currentConfig._sections), (section) => {
                    return MyPromise.serial(section.items, (item) => this._setupDeleteItem(processor, item, breakerId));
                }),
            )
            .then(() =>
                MyPromise.serial(_.values(this._desiredConfig._sections), (section) => {
                    return MyPromise.serial(section.items, (item) => this._setupCreateItem(processor, item, breakerId));
                }),
            )
            .then(() => this._logger.info('Processing... %s', this._id))
            .then(() => processor.process())
            .then(() => this._logger.info('Processing completed. %s', this._id))
            .catch((error) => {
                this._logger.error('Processing failed. %s', this._id);
                this._logger.error('Processing failed. %s', this._id, error);
                this._logger.exception(error);
                processResult.hasError = true;
                processResult.error = error;
            })
            .then(() => {
                processor.debugOutputIncompleteTasks();

                const taskCounter = _.mapValues(processor.tasksByState, (x) => x.length);

                processResult.taskErrors = processor.taskErrors;
                processResult.failedTaskCount = taskCounter[TaskState.Error];
                processResult.skippedTaskCount = taskCounter[TaskState.Unqualified] + taskCounter[TaskState.Skipped];
                processResult.runningTaskCount = taskCounter[TaskState.Running] + taskCounter[TaskState.WaitingFinish];
                processResult.idleTaskCount = taskCounter[TaskState.Idle];
                processResult.taskCounter = taskCounter;

                this._logger.info('Processing summary. %s', this._id, processResult);

                processor.close();
                return processResult;
            });
    }

    private _setupDeleteItem(
        processor: DependencyProcessor<DeltaTaskId>,
        item: ConfigItem,
        breakerId: DeltaTaskId,
    ): void {
        const itemId: DeltaTaskId = { dn: item.dn, action: TaskAction.Delete };

        this._logger.verbose('Setup delete item: %s', item.dn);

        processor.addTask(itemId);
        if (item.taskLabels) {
            for (const label of item.taskLabels) {
                processor.setLabel(itemId, label);
            }
        }
        if (item.nonConcurrentLabels) {
            processor.setNonConcurrentLabels(itemId, item.nonConcurrentLabels);
        }
        processor.setDependency(breakerId, itemId);
        for (const relation of item.relations) {
            const predecessorId: DeltaTaskId = { dn: relation.targetDn, action: TaskAction.Delete };
            processor.setDependency(predecessorId, itemId);
        }
    }

    private _setupCreateItem(
        processor: DependencyProcessor<DeltaTaskId>,
        item: ConfigItem,
        breakerId: DeltaTaskId,
    ): void {
        const itemId: DeltaTaskId = { dn: item.dn, action: TaskAction.Create };
        this._logger.verbose('Setup create item: %s', item.dn);

        processor.addTask(itemId);
        if (item.taskLabels) {
            for (const label of item.taskLabels) {
                processor.setLabel(itemId, label);
            }
        }
        if (item.nonConcurrentLabels) {
            processor.setNonConcurrentLabels(itemId, item.nonConcurrentLabels);
        }
        processor.setDependency(itemId, breakerId);
        for (const relation of item.relations) {
            const predecessorId: DeltaTaskId = { dn: relation.targetDn, action: TaskAction.Create };
            processor.setDependency(itemId, predecessorId);
        }
        if (item.preRunCheckerCb) {
            processor.setPreRunChecker(itemId, item.preRunCheckerCb);
        }
        if (item.completionCheckerCb) {
            processor.setCompletionChecker(itemId, item.completionCheckerCb);
        }
    }

    private _processDeltaItem(itemId: DeltaTaskId): boolean | Promise<boolean> {
        const dn = itemId.dn;

        this._logger.verbose('process: ' + dn);

        if (!dn) {
            return true;
        }

        const dnInfo = this._currentConfig.meta.breakDn(dn)!;
        const meta = dnInfo.meta;

        return Promise.resolve()
            .then(() => this._checkDependencies(itemId, dn, meta))
            .then((canContinue) => {
                this._logger.verbose(
                    '[_processDeltaItem]: %s. action=%s. dependencies canContinue=%s',
                    dn,
                    itemId.action,
                    canContinue,
                );
                if (!canContinue) {
                    return false;
                }

                return this._processAutoConfig(itemId, dn, meta);
            })
            .then((canContinue) => {
                this._logger.verbose(
                    '[_processDeltaItem]: %s. action=%s. autoconfig canContinue=%s',
                    dn,
                    itemId.action,
                    canContinue,
                );
                if (!canContinue) {
                    return false;
                }

                if (dn in this._deltaConfig) {
                    const deltaItem = this._deltaConfig[dn];
                    if (itemId.action == TaskAction.Create) {
                        return this._processDeltaCreate(deltaItem, meta);
                    } else if (itemId.action == TaskAction.Delete) {
                        return this._processDeltaDelete(deltaItem, meta);
                    }
                }
                return true;
            })
            .then((canContinue) => {
                this._logger.verbose('process: ' + dn + ' :: end');
                return canContinue;
            });
    }

    private _checkDependencies(itemId: DeltaTaskId, dn: string, meta: ConfigSectionMeta): boolean {
        this._logger.verbose('[_checkDependencies]: %s', dn, itemId.action);

        if (itemId.action != TaskAction.Create) {
            return true;
        }

        const deltaItem = this._deltaConfig[dn];
        if (!deltaItem) {
            return true;
        }

        for (const relation of deltaItem.item.relations) {
            this._logger.info('[_checkDependencies] testing %s => %s...', dn, relation.targetDn);

            if (relation.shouldIgnoreDependency) {
                this._logger.info('[_checkDependencies] ignore relation %s => %s', dn, relation.targetDn);
                continue;
            }

            const targetItem = relation.targetItem;
            if (!targetItem) {
                this._logger.info('[_checkDependencies] missing dependency %s => %s', dn, relation.targetDn);
                return false;
            }
            const resolvedItem = targetItem.resolved;
            if (!resolvedItem) {
                this._logger.info('[_checkDependencies] missing resolved %s => %s', dn, targetItem.dn);
                return false;
            }
            if (!resolvedItem.isReady) {
                this._logger.info('[_checkDependencies] dependency not ready %s => %s', dn, resolvedItem.dn);
                return false;
            }
        }

        return true;
    }

    private _processAutoConfig(itemId: DeltaTaskId, dn: string, meta: ConfigSectionMeta): boolean | Promise<boolean> {
        this._logger.verbose('[_processAutoConfig]: %s', dn, itemId.action);

        if (itemId.action != TaskAction.Create) {
            return true;
        }

        if (meta._autoConfig) {
            const currentItem = this._currentConfig.findDn(dn);
            const desiredItem = this._desiredConfig.findDn(dn);
            if (desiredItem) {
                this._logger.verbose('process: %s BEGIN AUTOCONFIG. Action: %s', dn, itemId.action);

                return Promise.resolve(desiredItem.performAutoConfig(itemId.action)).then((canContinue) => {
                    if (!canContinue) {
                        this._logger.verbose(
                            'process: %s END AUTOCONFIG :: CANNOT CONTINUE. Action: %s.',
                            dn,
                            itemId.action,
                        );
                        return false;
                    }

                    if (currentItem) {
                        const itemDelta = desiredItem.produceDelta(currentItem);
                        if (itemDelta) {
                            desiredItem.addToDeltaDict(this._deltaConfig, DeltaItemStatus.Update, itemDelta);
                            this._logger.verbose(
                                'process: %s to be updated after AUTOCONFIG. Action: %s.',
                                dn,
                                itemId.action,
                            );
                            this._deltaConfig[dn].output();
                            if (desiredItem.meta._onUpdateRecreateCb) {
                                if (desiredItem.meta._onUpdateRecreateCb(this._deltaConfig[dn])) {
                                    this._logger.verbose(
                                        'process: %s Marking Recreatable During AUTOCONFIG. Action: %s.',
                                        dn,
                                        itemId.action,
                                    );
                                    this._desiredConfig.markItemRecreateInDelta(this._deltaConfig, desiredItem);
                                }
                            }
                        } else {
                            this._logger.verbose(
                                'process: %s AUTOCONFIG returned none. Action: %s.',
                                dn,
                                itemId.action,
                            );
                            if (dn in this._deltaConfig) {
                                if (this._deltaConfig[dn].status != DeltaItemStatus.Recreate) {
                                    this._logger.verbose(
                                        'process: %s no change after AUTOCONFIG. Action: %s.',
                                        dn,
                                        itemId.action,
                                    );
                                    delete this._deltaConfig[dn];
                                } else {
                                    this._logger.verbose(
                                        'process: %s no change after AUTOCONFIG. But keeping recreate. Action: %s.',
                                        dn,
                                        itemId.action,
                                    );
                                }
                            }
                        }
                    } else {
                        desiredItem.addToDeltaDict(this._deltaConfig, DeltaItemStatus.Create);
                        this._logger.verbose(
                            'process: %s to be created after AUTOCONFIG. Action: %s.',
                            dn,
                            itemId.action,
                        );
                        this._deltaConfig[dn].output();
                    }

                    this._logger.verbose('process: %s END AUTOCONFIG. Action: %s.', dn, itemId.action);
                    return true;
                });
            }
        }

        return true;
    }

    private _processDeltaCreate(deltaItem: ConfigDeltaItem, meta: ConfigSectionMeta): boolean | Promise<boolean> {
        if (deltaItem.status == DeltaItemStatus.Create || deltaItem.status == DeltaItemStatus.Recreate) {
            this._logger.verbose('Process Delta Create %s', deltaItem.dn);

            let newlyCreatedItem: any = null;
            return Promise.resolve()
                .then(() => {
                    if (meta._onCreate) {
                        return Promise.resolve(meta.create(deltaItem)).then((obj: any) => {
                            if (!obj) {
                                this._logger.error('None returned from %s::_onCreate', deltaItem.dn);
                                return;
                            }
                            return deltaItem.resolutionConfig.section(meta.name).mergeItem(obj, deltaItem.item.runtime);
                        });
                    }
                })
                .then((item: any) => {
                    newlyCreatedItem = item;
                    const relations = deltaItem.item.relations;
                    return MyPromise.serial(relations, (relation: any) =>
                        this._processDeltaRelationCreate(deltaItem, relation.targetDn),
                    );
                })
                .then(() => {
                    if (meta._onPostCreate) {
                        if (newlyCreatedItem) {
                            return meta._onPostCreate(newlyCreatedItem);
                        }
                    }
                })
                .then(() => true);
        } else if (deltaItem.status == DeltaItemStatus.Update) {
            this._logger.verbose('Process Delta Update %s', deltaItem.dn);

            return Promise.resolve()
                .then(() => {
                    if (meta._onUpdate) {
                        return Promise.resolve(meta.update(deltaItem)).then(() => {
                            return this._refreshDeltaItem(deltaItem.item.root, deltaItem.dn);
                        });
                    }
                })
                .then(() => {
                    const relations = deltaItem.delta!.relations.filter((x) => x.state == DeltaState.Update);
                    return MyPromise.serial(relations, (relation) =>
                        this._processDeltaRelationDelete(deltaItem, relation.relation, relation.runtime),
                    );
                })
                .then(() => {
                    const relations = deltaItem.delta!.relations.filter(
                        (x) => x.state == DeltaState.Create || x.state == DeltaState.Update,
                    );
                    return MyPromise.serial(relations, (relation) =>
                        this._processDeltaRelationCreate(deltaItem, relation.relation),
                    );
                })
                .then(() => true);
        }

        return true;
    }

    private _processDeltaRelationCreate(deltaItem: ConfigDeltaItem, targetDn: string): any {
        this._logger.verbose('Creating relation %s => %s...', deltaItem.item.dn, targetDn);

        let target = deltaItem.item.root.findDn(targetDn);
        if (!target) {
            this._logger.error(
                '[_processDeltaRelationCreate] Could not fetch target %s for %s',
                targetDn,
                deltaItem.item.dn,
            );
            return;
        }
        return deltaItem.item.meta
            .relationCreate(deltaItem.item, target)
            .then((updated: any) => {
                if (!updated) {
                    return updated;
                }
                this._logger.verbose('Relation %s => %s is created. Result:', deltaItem.item.dn, targetDn, updated);
                return Promise.resolve()
                    .then(() => this._refreshDeltaItem(deltaItem.item.root, deltaItem.dn))
                    .then(() => this._refreshDeltaItem(target!.root, target!.dn))
                    .then(() => updated);
            })
            .then((updated: any) => {
                if (updated) {
                    target = deltaItem.item.root.findDn(targetDn);
                    return deltaItem.item.meta.postRelationCreate(deltaItem.item, target);
                }
            });
    }

    private _processDeltaRelationDelete(deltaItem: ConfigDeltaItem, targetDn: string, runtime?: any): any {
        this._logger.verbose('Deleting relation %s => %s...', deltaItem.item.dn, targetDn);
        const target = deltaItem.item.root.resolveDn(targetDn);
        if (!target) {
            this._logger.error(
                '[_processDeltaRelationDelete] Could not fetch target %s for %s',
                targetDn,
                deltaItem.item.dn,
            );
            return;
        }
        return deltaItem.item.meta.relationDelete(deltaItem.item, target, runtime).then((updated: any) => {
            if (!updated) {
                return;
            }
            return Promise.resolve()
                .then(() => this._refreshDeltaItem(deltaItem.item.root, deltaItem.dn))
                .then(() => this._refreshDeltaItem(target.root, target.dn));
        });
    }

    private _refreshDeltaItem(root: Config, dn: string): any {
        this._logger.verbose('Refreshing %s...', dn);
        const item = root.resolveDn(dn);
        if (!item) {
            this._logger.error('[_refreshDeltaItem] Could not fetch item for %s', dn);
            return;
        }
        return item.refresh();
    }

    private _processDeltaDelete(deltaItem: ConfigDeltaItem, meta: ConfigSectionMeta): boolean | Promise<boolean> {
        if (deltaItem.status == DeltaItemStatus.Delete || deltaItem.status == DeltaItemStatus.Recreate) {
            this._logger.verbose('Process Delta Delete %s', deltaItem.dn);

            return Promise.resolve()
                .then(() => {
                    const relations = deltaItem.item.relations;
                    return MyPromise.serial(relations, (relation: any) =>
                        this._processDeltaRelationDelete(deltaItem, relation.targetDn, relation.runtime),
                    );
                })
                .then(() => {
                    if (meta._onDelete) {
                        return Promise.resolve(meta._onDelete(deltaItem)).then(() => {
                            deltaItem.resolutionConfig.section(meta.name).remove(deltaItem.dn);
                        });
                    }
                })
                .then(() => true);
        } else if (deltaItem.status == DeltaItemStatus.Update) {
            this._logger.verbose('Process Delta Delete Updated Relations %s', deltaItem.dn);

            return Promise.resolve()
                .then(() => {
                    const relations = deltaItem.delta!.relations.filter((x) => x.state == DeltaState.Delete);
                    return MyPromise.serial(relations, (relation) =>
                        this._processDeltaRelationDelete(deltaItem, relation.relation, relation.runtime),
                    );
                })
                .then(() => true);
        }

        return true;
    }
}
