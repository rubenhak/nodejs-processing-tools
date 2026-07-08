import _ from 'the-lodash';
import { MyPromise } from 'the-promise';
import * as fs from 'fs';

import { ConfigSection } from './section';
import { ConfigRelation, ConfigRelationLeg } from './relation';
import { DeltaDict } from './delta-item';
import { DeltaItemStatus, ItemDelta } from './types';
import type { ConfigItem } from './item';
import type { ConfigMeta } from './meta';
import { ILogger } from '../logger';

export class Config {
    private _meta: ConfigMeta;
    private _logger: ILogger;
    private _resolutionConfig?: Config;
    _sections: Record<string, ConfigSection>;
    private _relationOwners: Record<string, ConfigRelation[]>;
    private _relations: Record<string, ConfigRelation[]>;

    constructor(meta: ConfigMeta, resolutionConfig?: Config) {
        this._meta = meta;
        this._logger = meta.logger;
        this._resolutionConfig = resolutionConfig;
        this._sections = {};
        for (const sectionMeta of this._meta.sections) {
            this._sections[sectionMeta.name] = new ConfigSection(this, sectionMeta);
        }
        this._relationOwners = {};
        this._relations = {};
    }

    get meta(): ConfigMeta {
        return this._meta;
    }

    get logger(): ILogger {
        return this._logger;
    }

    get resolutionConfig(): Config | undefined {
        return this._resolutionConfig;
    }

    get isConfig(): boolean {
        if (this._resolutionConfig) {
            return true;
        }
        return false;
    }

    registerRelation(relation: ConfigRelation): Promise<ConfigRelation> {
        if (relation.sourceDn in this._relations) {
            const existings = this._relations[relation.sourceDn].filter((x) => x.targetDn == relation.targetDn);
            if (existings.length > 0) {
                return Promise.resolve(existings[0]);
            }
        }

        this._logger.verbose('Creating relation %s => %s', relation.sourceDn, relation.targetDn);

        if (!(relation.ownerDn in this._relationOwners)) {
            this._relationOwners[relation.ownerDn] = [];
        }
        this._relationOwners[relation.ownerDn].push(relation);

        if (!(relation.sourceDn in this._relations)) {
            this._relations[relation.sourceDn] = [];
        }
        this._relations[relation.sourceDn].push(relation);

        return Promise.resolve()
            .then(() => this._ensurePresent(relation.sourceLeg))
            .then(() => this._ensurePresent(relation.targetLeg))
            .then(() => relation);
    }

    private _ensurePresent(relationLeg: ConfigRelationLeg): Promise<any> {
        return Promise.resolve(this._extractRelationLegItem(relationLeg)).then((item: any) => {
            if (!item) {
                return;
            }
            if (relationLeg.autoCreate) {
                item.addOwner(relationLeg.parent.ownerDn);
            }
        });
    }

    private _extractRelationLegItem(relationLeg: ConfigRelationLeg): any {
        const meta = relationLeg.meta;
        let item = this.findDn(relationLeg.dn);

        if (this.isConfig) {
            if (relationLeg.autoCreate) {
                this._logger.verbose('AutoCreating Config %s...', relationLeg.dn, relationLeg.autoCreateRuntime);
                item = this.section(meta.name).create(relationLeg.naming);
            }
            return item;
        } else {
            if (relationLeg.autoCreate) {
                if (item) {
                    if (relationLeg.autoCreateRuntime) {
                        if (_.fastDeepEqual(item.runtime, relationLeg.autoCreateRuntime)) {
                            return item;
                        } else {
                            this._logger.verbose(
                                'Runtimes are different for %s. ItemRuntime: %s, RelationRuntime: %s...',
                                relationLeg.dn,
                                JSON.stringify(item.runtime),
                                JSON.stringify(relationLeg.autoCreateRuntime),
                            );
                        }
                    } else {
                        return item;
                    }
                }

                this._logger.verbose('AutoCreating %s...', relationLeg.dn, relationLeg.autoCreateRuntime);
                if (meta._onQuery) {
                    const id = meta._extractIdFromNaming!(relationLeg.naming, relationLeg.autoCreateRuntime);
                    return Promise.resolve(meta.query(id, relationLeg.autoCreateRuntime)).then((obj: any) =>
                        this.section(meta.name).mergeItem(obj, relationLeg.autoCreateRuntime),
                    );
                }
            }
        }
    }

    getOwnedRelations(ownerDn: string): ConfigRelation[] {
        if (ownerDn in this._relationOwners) {
            return this._relationOwners[ownerDn].slice();
        }
        return [];
    }

    getTargetRelations(sourceDn: string): ConfigRelation[] {
        if (!(sourceDn in this._relations)) {
            return [];
        }
        return this._relations[sourceDn].slice();
    }

    getSourceRelations(targetDn: string, sourceMetaName?: string): ConfigRelation[] {
        const result: ConfigRelation[] = [];
        for (const relations of _.values(this._relations)) {
            for (const relation of relations) {
                if (relation.targetDn == targetDn) {
                    if (sourceMetaName) {
                        if (relation.sourceMetaName == sourceMetaName) {
                            result.push(relation);
                        }
                    } else {
                        result.push(relation);
                    }
                }
            }
        }
        return result;
    }

    deleteRelationsByOwner(ownerDn: string): void {
        for (const relation of this.getOwnedRelations(ownerDn)) {
            this.deleteRelation(relation);
        }
    }

    deleteRelation(relation: ConfigRelation): void {
        for (const leg of relation.legs) {
            if (leg.autoCreate) {
                const item = leg.item;
                if (item) {
                    item.deleteOwner(relation.ownerDn);
                }
            }
        }

        _.remove(this._relationOwners[relation.ownerDn], (x) => x === relation);
        if (this._relationOwners[relation.ownerDn].length == 0) {
            delete this._relationOwners[relation.ownerDn];
        }

        _.remove(this._relations[relation.sourceDn], (x) => x === relation);
        if (this._relations[relation.sourceDn].length == 0) {
            delete this._relations[relation.sourceDn];
        }
    }

    section(name: string): ConfigSection {
        if (!(name in this._sections)) {
            throw new Error('No section ' + name + ' present.');
        }
        return this._sections[name];
    }

    extract(filter?: any): Promise<any> {
        let sections = this._meta.sections;
        if (filter) {
            sections = sections.filter(filter);
        }
        const sectionGroups = _.groupBy(sections, (x) => x._priority);
        let priorities = _.keys(sectionGroups);
        priorities = _.sortBy(priorities, (x) => parseInt(x));
        return MyPromise.serial(priorities, (x) => this._extractSections(x, sectionGroups[x])).then(() =>
            this._performPostProcess(),
        );
    }

    private _extractSections(priority: string, sections: any[]): Promise<any> {
        this._logger.verbose('[_extractSections] Priority: %s...', priority);
        return MyPromise.serial(sections, (sectionMeta) => this._extractSection(sectionMeta));
    }

    private _performPostProcess(): Promise<any> {
        return MyPromise.serial(_.values(this._sections), (section) => section._performPostProcess());
    }

    performAutoConfig(): Promise<any> {
        return MyPromise.serial(_.values(this._sections), (section) => section.performAutoConfig());
    }

    findDn(dn: string): ConfigItem | null {
        const dnInfo = this._meta.breakDn(dn);
        if (!dnInfo) {
            return null;
        }
        return this.section(dnInfo.metaName).find(dn);
    }

    resolveDn(dn: string): ConfigItem | null {
        if (this._resolutionConfig) {
            return this._resolutionConfig.resolveDn(dn);
        }
        return this.findDn(dn);
    }

    find(metaName: string, naming: any): ConfigItem | null {
        const meta = this._meta.get(metaName);
        const dn = meta.constructDn(naming);
        return this.findDn(dn);
    }

    resolve(metaName: string, naming: any): ConfigItem | null {
        const meta = this._meta.get(metaName);
        const dn = meta.constructDn(naming);
        return this.resolveDn(dn);
    }

    produceDelta(base: Config): DeltaDict {
        const delta: DeltaDict = {};
        for (const sectionMeta of this._meta.sections) {
            const mySection = this.section(sectionMeta.name);
            const baseSection = base.section(sectionMeta.name);
            mySection.produceDelta(delta, baseSection);
        }
        const toBeRecreatedItems: ConfigItem[] = [];
        for (const sectionMeta of this._meta.sections) {
            if (sectionMeta._onUpdateRecreateCb) {
                for (const itemDn of _.keys(delta)) {
                    if (this._meta.breakDn(itemDn)!.meta == sectionMeta) {
                        if (delta[itemDn].status == DeltaItemStatus.Update) {
                            if (sectionMeta._onUpdateRecreateCb(delta[itemDn])) {
                                toBeRecreatedItems.push(delta[itemDn].item);
                            }
                        }
                    }
                }
            }
        }
        this._markItemsRecreate(delta, toBeRecreatedItems);
        return delta;
    }

    markItemRecreateInDelta(delta: DeltaDict, item: ConfigItem): void {
        return this._markItemsRecreate(delta, [item]);
    }

    private _markItemsRecreate(delta: DeltaDict, items: ConfigItem[]): void {
        if (items.length == 0) {
            return;
        }
        const toBeRecreatedItems: ConfigItem[] = [];
        for (const item of items) {
            this._markItemRecreate(delta, item, toBeRecreatedItems);
        }
        this._markItemsRecreate(delta, toBeRecreatedItems);
    }

    private _markItemRecreate(delta: DeltaDict, item: ConfigItem, toBeRecreatedItems: ConfigItem[]): void {
        this._logger.verbose('[_markItemRecreate] %s', item.dn);
        let currDeltaData: ItemDelta | null | undefined = null;
        if (delta[item.dn]) {
            if (delta[item.dn].status == DeltaItemStatus.Recreate) {
                return;
            }
            if (delta[item.dn].status == DeltaItemStatus.Update) {
                currDeltaData = delta[item.dn].delta;
            }
        }
        item.addToDeltaDict(delta, DeltaItemStatus.Recreate, currDeltaData);

        const relations = this.getSourceRelations(item.dn);
        for (const relation of relations) {
            this._logger.verbose('[_markItemRecreate] ?? %s', relation.sourceDn);

            const sourceItem = relation.sourceItem;
            if (sourceItem.meta._onUpdateRecreateCb) {
                if (sourceItem.meta._onUpdateRecreateCb(null)) {
                    if (sourceItem.dn in delta) {
                        if (delta[sourceItem.dn].status == DeltaItemStatus.Update) {
                            this._logger.verbose('[_markItemRecreate] -> %s', sourceItem.dn);
                            toBeRecreatedItems.push(sourceItem);
                        }
                    } else {
                        this._logger.verbose('[_markItemsRecreate] => %s', sourceItem.dn);
                        toBeRecreatedItems.push(sourceItem);
                    }
                }
            }
        }
    }

    exportToData(): any {
        const data: any = {
            sections: {},
            relations: [],
        };
        for (const sectionMeta of this._meta.sections) {
            const section = this._sections[sectionMeta.name];
            data.sections[section.meta.name] = section.exportToData();
        }
        for (const relations of _.values(this._relations)) {
            for (const relation of relations) {
                const relationData = relation.exportToData();
                data.relations.push(relationData);
            }
        }
        return data;
    }

    loadFromData(data: any): Promise<any> {
        return Promise.resolve()
            .then(() => {
                return MyPromise.serial(_.keys(data.sections), (x) => {
                    const section = this._sections[x];
                    if (!section) {
                        throw new Error('Invalid section ' + x);
                    }
                    return section.loadFromData(data.sections[x]);
                });
            })
            .then(() => {
                return MyPromise.serial(data.relations, (relationData: any) => {
                    const relation = ConfigRelation.createFromData(this, relationData);
                    return this.registerRelation(relation);
                });
            });
    }

    exportToFile(path: string): void {
        const data = this.exportToData();
        fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    }

    loadFromFile(path: string): Promise<any> {
        const dataStr = fs.readFileSync(path, 'utf8');
        const data = JSON.parse(dataStr);
        return this.loadFromData(data);
    }

    private _extractSection(sectionMeta: any): Promise<any> {
        const section = this._sections[sectionMeta.name];
        return section.queryAll();
    }

    debugOutputToFile(fileName: string): Promise<any> | any {
        const writer = this._logger.outputStream(fileName);
        if (!writer) {
            return Promise.resolve();
        }

        for (const sectionName of this._meta.sections.map((x) => x.name).sort()) {
            writer.writeHeader(sectionName);
            this._sections[sectionName].debugOutputToFile(writer);
        }
        writer.write();
        writer.write();
        for (const relationList of _.orderBy(_.values(this._relations), ['sourceDn', 'targetDn'])) {
            for (const relation of relationList) {
                writer.indent();
                writer.write(
                    relation.sourceDn +
                        ' => ' +
                        relation.targetDn +
                        ', Target: ' +
                        JSON.stringify(relation.targetId) +
                        ', Resolved: ' +
                        JSON.stringify(relation.resolvedTargetId),
                );
                if (relation.runtime) {
                    writer.indent();
                    writer.write('Runtime:');
                    writer.write(relation.runtime);
                    writer.unindent();
                }
                if (relation.sourceLeg.autoCreate) {
                    writer.indent();
                    writer.write('Source Autocreate. Runtime:');
                    writer.write(relation.sourceLeg.autoCreateRuntime);
                    writer.unindent();
                }
                if (relation.targetLeg.autoCreate) {
                    writer.indent();
                    writer.write('Target Autocreate. Runtime:');
                    writer.write(relation.targetLeg.autoCreateRuntime);
                    writer.unindent();
                }
                writer.unindent();
            }
        }
        return writer.close();
    }

    output(): void {
        for (const sectionMeta of this._meta.sections) {
            const section = this._sections[sectionMeta.name];
            section.output();
        }
    }
}
