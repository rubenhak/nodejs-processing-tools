import _ from 'the-lodash';
import { MyPromise } from 'the-promise';

import { ConfigItem } from './item';
import { ConfigRelation } from './relation';
import { DeltaDict } from './delta-item';
import { DeltaItemStatus } from './types';
import type { Config } from './config';
import type { ConfigSectionMeta } from './meta/section';
import { ILogger, IOutputWriter } from '../logger';

export class ConfigSection {
    private _root: Config;
    private _logger: ILogger;
    private _meta: ConfigSectionMeta;
    private _itemDict: Record<string, ConfigItem>;

    constructor(root: Config, meta: ConfigSectionMeta) {
        this._root = root;
        this._logger = meta.logger;
        this._meta = meta;
        this._itemDict = {};
    }

    get root(): Config {
        return this._root;
    }

    get meta(): ConfigSectionMeta {
        return this._meta;
    }

    get items(): ConfigItem[] {
        return _.values(this._itemDict);
    }

    queryAll(): Promise<any> {
        return Promise.resolve()
            .then(() => this._queryList())
            .then(() => this._querySubstitutes())
            .then(() => {
                if (!this.meta._onPostQueryAll) {
                    return;
                }
                return this.meta._onPostQueryAll(this.items);
            });
    }

    private _querySubstitutes(): Promise<any> {
        return MyPromise.serial(this.meta._substitutes, (x) => this._querySubstitute(x));
    }

    private _querySubstitute(subtitute: any): Promise<any> {
        this._logger.verbose('Querying subtitute %s :: %s :: %s...', this.meta.name, subtitute.id, subtitute.naming);
        return this.meta.query(subtitute.id).then((obj: any) => {
            this._logger.verbose('Subtitue %s :: %s Result: ', this.meta.name, subtitute.id, obj);
            return this.mergeItem(obj);
        });
    }

    private _queryList(): Promise<any> {
        if (!this.meta._queryAll) {
            return Promise.resolve();
        }
        this._logger.info('Querying section %s', this.meta.name);
        return Promise.resolve(this.meta._queryAll()).then((result: any) => {
            this._logger.verbose('Querying section %s, Result received.', this.meta.name);
            this._logger.silly('Querying section %s, Result:', this.meta.name, result);
            return MyPromise.serial(result, (obj: any) => this.mergeItem(obj));
        });
    }

    find(dn: string): ConfigItem | null {
        if (dn in this._itemDict) {
            return this._itemDict[dn];
        }
        return null;
    }

    findByNaming(naming: any): ConfigItem | null {
        const dn = this.meta.constructDn(naming);
        return this.find(dn);
    }

    removeAll(): void {
        for (const item of this.items) {
            item.remove();
        }
    }

    remove(dn: string): void {
        const item = this.find(dn);
        if (item) {
            this.root.deleteRelationsByOwner(item.dn);
            delete this._itemDict[item.dn];
        }
    }

    create(naming: any): ConfigItem {
        this._logger.silly('Adding %s %s', this.meta.name, naming);
        const item = ConfigItem.createNew(this._root, this.meta, naming);
        this._logger.silly('    Added %s. isConfig=%s', item.dn, this.root.isConfig);
        return this._insertItem(item);
    }

    produceDelta(delta: DeltaDict, baseSection: ConfigSection): void {
        if (this.meta.ignoreDelta) {
            return;
        }
        const baseItems = baseSection.items;
        for (const item of this.items) {
            const baseItem = _.find(baseItems, (x) => x.dn == item.dn);
            if (baseItem) {
                const itemDelta = item.produceDelta(baseItem);
                if (itemDelta) {
                    item.addToDeltaDict(delta, DeltaItemStatus.Update, itemDelta);
                }
                _.remove(baseItems, (x) => x === baseItem);
            } else {
                item.addToDeltaDict(delta, DeltaItemStatus.Create);
            }
        }
        for (const item of baseItems) {
            item.addToDeltaDict(delta, DeltaItemStatus.Delete);
        }
    }

    private _mergeResult(result: any): void {
        if (!result) {
            return;
        }
        //this._logger.info('Section %s query result:', section.meta.name, result);
    }

    mergeItem(obj: any, autoCreateRuntime?: any): any {
        if (!obj) {
            this._logger.error('Could not merge %s item since it is null', this.meta.name);
            return;
        }
        this._logger.verbose('Merging item to section %s', this.meta.name, obj);
        const naming = this.meta.extractNaming(obj, autoCreateRuntime);
        const item = this.create(naming);
        return item.acceptObj(obj);
    }

    private _insertItem(item: ConfigItem): ConfigItem {
        if (item.dn in this._itemDict) {
            return this._itemDict[item.dn];
        }
        this._itemDict[item.dn] = item;
        return item;
    }

    cloneFrom(otherConfig: Config, skipRelations?: boolean, relationFilter?: any): Promise<any> {
        return MyPromise.serial(otherConfig.section(this.meta.name).items, (x) =>
            this.cloneSingleItemFrom(x, skipRelations, relationFilter),
        );
    }

    cloneSingleItemFrom(otherItem: ConfigItem, skipRelations?: boolean, relationFilter?: any): Promise<any> {
        return Promise.resolve()
            .then(() => {
                const item = this.create(otherItem.naming);
                item.cloneFrom(otherItem);
            })
            .then(() => {
                if (skipRelations) {
                    return;
                }
                return MyPromise.serial(otherItem.getOwnedRelations(), (otherRelation: any) => {
                    if (relationFilter) {
                        if (
                            !_.includes(relationFilter, otherRelation.sourceMeta.name) &&
                            !_.includes(relationFilter, otherRelation.targetMeta.name)
                        ) {
                            return;
                        }
                    }
                    const relation = new ConfigRelation(
                        this.root,
                        otherItem.dn,
                        otherRelation.sourceMeta,
                        otherRelation.sourceNaming,
                        otherRelation.targetMeta,
                        otherRelation.targetNaming,
                        otherRelation.targetId,
                        otherRelation.runtime,
                    );
                    relation.sourceLeg.setupAutoCreate(
                        otherRelation.sourceLeg.autoCreate,
                        otherRelation.sourceLeg.autoCreateRuntime,
                    );
                    relation.targetLeg.setupAutoCreate(
                        otherRelation.targetLeg.autoCreate,
                        otherRelation.targetLeg.autoCreateRuntime,
                    );
                    if (otherRelation.shouldIgnoreDelta) {
                        relation.markIgnoreDelta();
                    }
                    if (otherRelation.shouldIgnoreDependency) {
                        relation.markIgnoreDependency();
                    }
                    return this.root.registerRelation(relation);
                });
            });
    }

    _performPostProcess(): Promise<any> {
        return MyPromise.serial(this.items, (item) => item.performPostProcess());
    }

    performAutoConfig(): Promise<any> | undefined {
        if (this.meta._autoConfig) {
            return MyPromise.serial(this.items, (item) => item.performAutoConfig());
        }
    }

    exportToData(): any {
        const data: Record<string, any> = {};
        for (const item of this.items) {
            const itemData = item.exportToData();
            if (itemData) {
                data[item.dn] = itemData;
            }
        }
        return data;
    }

    loadFromData(data: any): void {
        for (const itemData of _.values(data) as any[]) {
            const item = this.create(itemData.naming);
            item.loadFromData(itemData);
        }
    }

    outputDetailed(): void {
        for (const item of this.items) {
            item.outputDetailed();
        }
    }

    output(): void {
        for (const item of this.items) {
            item.output();
        }
    }

    debugOutputToFile(writer: IOutputWriter): void {
        for (const item of _.sortBy(this.items, (x) => x.dn)) {
            item.debugOutputToFile(writer);
            writer.write();
        }
    }
}
