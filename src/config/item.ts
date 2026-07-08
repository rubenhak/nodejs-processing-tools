import _ from 'the-lodash';
import { MyPromise } from 'the-promise';

import { ConfigRelation } from './relation';
import { ConfigDeltaItem, DeltaDict } from './delta-item';
import { RelationConstructor, RelationInfo } from './relation-constructor';
import { ConfigMeta } from './meta';
import type { ConfigSectionMeta } from './meta/section';
import type { Config } from './config';
import { ConfigPropertyDelta, DeltaItemStatus, DeltaState, ItemDelta, RelationDelta } from './types';
import { ILogger, IOutputWriter } from '../logger';

export class ConfigItem {
    private _root: Config;
    private _logger: ILogger;
    private _meta: ConfigSectionMeta;
    private _naming: any[];
    private _dn: string;
    private _config: Record<string, any>;
    private _runtime: any;
    private _autoCreatedOwners: Record<string, boolean>;
    private _isReady: boolean;
    private _obj: any;
    private _id: any;

    _isSubtitute?: boolean;
    _cannotCreate?: boolean;
    _cannotDelete?: boolean;
    _cannotUpdate?: boolean;

    taskLabels?: any;
    nonConcurrentLabels?: any;
    resolvedTargetId?: any;
    preRunCheckerCb?: any;
    completionCheckerCb?: any;

    constructor(root: Config, meta: ConfigSectionMeta, naming: any) {
        if (!_.isArray(naming)) {
            naming = [naming];
        }

        this._root = root;
        this._logger = meta.logger;
        this._meta = meta;
        this._naming = naming;
        this._dn = meta.constructDn(naming);
        this._config = {};
        this._runtime = {};
        this._autoCreatedOwners = {};

        if (this.isConfig) {
            this._isReady = true;
        } else {
            this._isReady = false;
        }

        ConfigMeta.validateNaming(this.naming);

        this._obj = null;
        this._id = null;
    }

    get logger(): ILogger {
        return this._logger;
    }

    get root(): Config {
        return this._root;
    }

    get isConfig(): boolean {
        return this.root.isConfig;
    }

    get meta(): ConfigSectionMeta {
        return this._meta;
    }

    get naming(): any[] {
        return this._naming;
    }

    get dn(): string {
        return this._dn;
    }

    get config(): Record<string, any> {
        return this._config;
    }

    get runtime(): any {
        return this._runtime;
    }

    get resolved(): ConfigItem | null {
        if (this.isConfig) {
            const item = this._root.resolveDn(this.dn);
            return item;
        }
        return this;
    }

    get obj(): any {
        if (this.isConfig) {
            const item = this._root.resolveDn(this.dn);
            if (item) {
                return item.obj;
            }
        }
        return this._obj;
    }

    get id(): any {
        if (this.isConfig) {
            const item = this._root.resolveDn(this.dn);
            if (item) {
                return item.id;
            }
        }
        return this._id;
    }

    get relations(): ConfigRelation[] {
        return this.root.getTargetRelations(this.dn);
    }

    get isReady(): boolean {
        return this._isReady;
    }

    exportToData(): any {
        const data = {
            naming: this._naming,
            config: this._config,
            runtime: this._runtime,
            obj: this._obj,
            id: this._id,
            autoCreatedOwners: this._autoCreatedOwners,
        };
        return data;
    }

    loadFromData(data: any): void {
        this._setConfig(data.config);
        this._obj = data.obj;
        this._runtime = data.runtime;
        this._id = data.id;
        this._autoCreatedOwners = data.autoCreatedOwners;
    }

    private _setConfig(newConfig: Record<string, any> | null | undefined): void {
        if (!newConfig) {
            this._config = {};
        } else {
            this._config = newConfig;
        }
    }

    addOwner(relationOwnerDn: string): void {
        this._autoCreatedOwners[relationOwnerDn] = true;
    }

    deleteOwner(relationOwnerDn: string): void {
        delete this._autoCreatedOwners[relationOwnerDn];
        if (_.keys(this._autoCreatedOwners).length == 0) {
            this.remove();
        }
    }

    remove(): void {
        this.root.section(this.meta.name).remove(this.dn);
    }

    cloneFrom(otherItem: ConfigItem): void {
        this._setConfig(_.cloneDeep(otherItem._config));
        this._runtime = _.cloneDeep(otherItem._runtime);
        this._obj = otherItem._obj;
        this._id = otherItem._id;
    }

    deleteRelation(targetDn: string): void {
        const relation = _.head(this.relations.filter((x) => x.targetDn == targetDn));
        if (relation) {
            this.root.deleteRelation(relation);
        }
    }

    deleteAllRelations(): void {
        for (const relation of this.relations) {
            this.root.deleteRelation(relation);
        }
    }

    deleteRelationsByMeta(targetMetaName: string): void {
        const relations = this.relations.filter((x) => x.targetMetaName == targetMetaName);
        for (const relation of relations) {
            this.root.deleteRelation(relation);
        }
    }

    relation(targetSectionName: any, targetNaming?: any, targetId?: any, runtime?: any): any {
        if (targetSectionName instanceof ConfigItem) {
            return this.relation(targetSectionName.meta.name, targetSectionName.naming);
        }

        const targetMeta = this.meta.root.get(targetSectionName);
        const rel = new ConfigRelation(
            this.root,
            this.dn,
            this.meta,
            this.naming,
            targetMeta,
            targetNaming,
            targetId,
            runtime,
        );
        return this.root.registerRelation(rel);
    }

    relationAutoCreatable(targetSectionName: string, targetNaming: any, targetAutocreateRuntime: any): any {
        const targetMeta = this.meta.root.get(targetSectionName);
        const rel = new ConfigRelation(
            this.root,
            this.dn,
            this.meta,
            this.naming,
            targetMeta,
            targetNaming,
            null,
            null,
        );
        rel.targetLeg.setupAutoCreate(true, targetAutocreateRuntime);
        return this.root.registerRelation(rel);
    }

    inverseRelationAutoCreatable(sourceSectionName: string, sourceNaming: any, sourceAutocreateRuntime: any): any {
        const sourceMeta = this.meta.root.get(sourceSectionName);
        const rel = new ConfigRelation(
            this.root,
            this.dn,
            sourceMeta,
            sourceNaming,
            this.meta,
            this.naming,
            null,
            null,
        );
        rel.sourceLeg.setupAutoCreate(true, sourceAutocreateRuntime);
        return this.root.registerRelation(rel);
    }

    findRelation(targetSectionName: string): ConfigRelation | undefined {
        return _.head(this.findRelations(targetSectionName));
    }

    findRelations(targetSectionName: string): ConfigRelation[] {
        const relations = this.relations.filter((x) => x.targetMetaName == targetSectionName);
        return relations;
    }

    getOwnedRelations(): ConfigRelation[] {
        return this._root.getOwnedRelations(this.dn);
    }

    getRelationByTargetDn(targetSectionName: string, dn: string): ConfigRelation | undefined {
        const relations = this.relations.filter((x) => x.targetDn == dn);
        return _.head(relations);
    }

    getRelationByTargetNaming(targetSectionName: string, naming: any): ConfigRelation | undefined {
        const dn = this.meta.root.constructDn(targetSectionName, naming);
        return this.getRelationByTargetDn(targetSectionName, dn);
    }

    setConfig(name: string, value: any): this {
        this._config[name] = value;
        return this;
    }

    setRuntime(value: any): this {
        this._runtime = value;
        return this;
    }

    produceDelta(baseItem: ConfigItem): ItemDelta | null {
        const deltaConfigs = this._produceDeltaConfigs(baseItem);
        const deltaRelations = this._produceDeltaRelations(baseItem);
        if (_.keys(deltaConfigs).length + deltaRelations.length > 0) {
            return {
                configs: deltaConfigs,
                relations: deltaRelations,
            };
        }
        return null;
    }

    private _areConfigsEqual(key: string, baseConfig: any, myConfig: any): boolean {
        if (this.meta.useDefaultsForDelta) {
            const arrayMeta = this.meta.getConfigArrayMetadata(key);
            return _.isDefaultedEqual(baseConfig, myConfig, arrayMeta);
        }
        return _.fastDeepEqual(baseConfig, myConfig);
    }

    private _produceDeltaConfigs(baseItem: ConfigItem): Record<string, ConfigPropertyDelta> {
        const deltaConfigs: Record<string, ConfigPropertyDelta> = {};
        const baseConfigs = _.clone(baseItem._config);
        for (const key of _.keys(this._config)) {
            const myConfig = this._config[key];
            if (key in baseConfigs) {
                const baseConfig = baseConfigs[key];
                const isEqual = this._areConfigsEqual(key, baseConfig, myConfig);
                if (!isEqual) {
                    deltaConfigs[key] = {
                        oldValue: baseConfig,
                        value: myConfig,
                        state: DeltaState.Update,
                    };
                }
                _.unset(baseConfigs, key);
            } else {
                deltaConfigs[key] = {
                    value: myConfig,
                    state: DeltaState.Create,
                };
            }
        }
        for (const key of _.keys(baseConfigs)) {
            const baseConfig = baseConfigs[key];
            deltaConfigs[key] = {
                oldValue: baseConfig,
                state: DeltaState.Delete,
            };
        }
        return deltaConfigs;
    }

    private _produceDeltaRelations(baseItem: ConfigItem): RelationDelta[] {
        const deltaRelations: RelationDelta[] = [];
        const baseRelations = _.clone(baseItem.relations);
        const targetRelations = this.relations.filter((x) => !x.shouldIgnoreDelta);
        for (const relation of targetRelations) {
            const baseRelation = _.find(baseRelations, (x) => x.targetDn == relation.targetDn);
            if (baseRelation) {
                if (baseRelation.targetId && relation.resolvedTargetId) {
                    if (!_.fastDeepEqual(baseRelation.targetId, relation.resolvedTargetId)) {
                        deltaRelations.push({
                            targetMeta: relation.targetMeta.name,
                            relation: relation.targetDn,
                            currentId: baseRelation.targetId,
                            resolvedTargetId: relation.resolvedTargetId,
                            state: DeltaState.Update,
                        });
                    }
                }
                _.remove(baseRelations, (x) => x === baseRelation);
            } else {
                deltaRelations.push({
                    targetMeta: relation.targetMeta.name,
                    relation: relation.targetDn,
                    state: DeltaState.Create,
                });
            }
        }
        for (const baseRelation of baseRelations) {
            deltaRelations.push({
                targetMeta: baseRelation.targetMeta.name,
                relation: baseRelation.targetDn,
                runtime: baseRelation.runtime,
                state: DeltaState.Delete,
            });
        }
        return deltaRelations;
    }

    addToDeltaDict(deltaDict: DeltaDict, state: DeltaItemStatus, itemDelta?: ItemDelta | null): void {
        if (state == DeltaItemStatus.Recreate) {
            if (this._cannotCreate) {
                this._logger.verbose('[addToDeltaDict] %s :: cannot recreate becase _cannotCreate...', this.dn);
                return;
            }
            if (this._cannotDelete) {
                this._logger.verbose('[addToDeltaDict] %s :: cannot recreate becase _cannotDelete.', this.dn);
                return;
            }
        } else if (state == DeltaItemStatus.Create) {
            if (this._cannotCreate) {
                this._logger.verbose('[addToDeltaDict] %s :: cannot create.', this.dn);
                return;
            }
        } else if (state == DeltaItemStatus.Delete) {
            if (this._cannotDelete) {
                this._logger.verbose('[addToDeltaDict] %s :: cannot delete.', this.dn);
                return;
            }
        } else if (state == DeltaItemStatus.Update) {
            if (this._cannotUpdate) {
                this._logger.verbose('[addToDeltaDict] %s :: cannot update.', this.dn);
                return;
            }
        }
        if (this.meta._onCheckIgnoreDelta) {
            if (this.meta._onCheckIgnoreDelta(this, state, itemDelta)) {
                return;
            }
        }
        deltaDict[this.dn] = new ConfigDeltaItem(this, state, itemDelta);
    }

    refresh(): Promise<any> {
        if (!this.isConfig) {
            if (this.meta._onQuery) {
                return Promise.resolve(this.meta._onQuery(this.id, this.runtime)).then((obj) => this.acceptObj(obj));
            }
        }
        return Promise.resolve();
    }

    executeAction(name: string, args: any): any {
        const action = this.meta._actions[name];
        if (!action) {
            throw new Error('Missing action: ' + name + ' on ' + this.meta.name);
        }
        const actualArgs: any[] = [this];
        if (_.isArray(args)) {
            for (const x of args) {
                actualArgs.push(x);
            }
        } else {
            actualArgs.push(args);
        }
        return action.apply(null, actualArgs);
    }

    performPostProcess(): any {
        return this.meta.postProcess(this);
    }

    private _performReadyCheck(): any {
        if (this.isConfig) {
            this._isReady = true;
            return;
        }

        if (!this.meta._checkReady) {
            this._isReady = true;
        } else {
            return Promise.resolve(this.meta._checkReady(this)).then((result) => {
                if (result) {
                    this._isReady = true;
                } else {
                    this._isReady = false;
                }
            });
        }
    }

    performAutoConfig(action?: any): any {
        if (this.meta._autoConfig) {
            this._logger.info('Running autoconfig on %s...', this.dn);
            return this.meta._autoConfig(this, action);
        }
    }

    outputDetailed(): void {
        this._logger.info('Section %s, Dn: %s, item:', this.meta.name, this.dn, {
            obj: this._obj,
            config: this._config,
            id: this._id,
        });
        for (const relation of this.relations) {
            this._logger.info(
                'Relation %s => %s, Target: %s, Resolved: %s',
                this.dn,
                relation.targetDn,
                JSON.stringify(relation.targetId),
                JSON.stringify(relation.resolvedTargetId),
            );
        }
    }

    output(): void {
        this._logger.info('Item: %s, %s, isConfig: %s', this.dn, this.resolvedTargetId, this.isConfig);
        this._logger.info('    IsReady: %s', this.isReady);
        for (const relation of this.relations) {
            this._logger.info(
                '    => %s, Target: %s, Resolved: %s',
                relation.targetDn,
                JSON.stringify(relation.targetId),
                JSON.stringify(relation.resolvedTargetId),
            );
        }
        this._logger.info('    Config%s', '', this._config);
        this._logger.info('    Runtime%s', '', this._runtime);
    }

    debugOutputToFile(writer: IOutputWriter): void {
        writer.write();
        writer.write('-) ' + this.dn);
        writer.indent();
        writer.write('Naming: ' + JSON.stringify(this.naming));
        if (this.id) {
            writer.write('Id: ' + JSON.stringify(this.id));
        }
        if (this._isSubtitute) {
            writer.write('IsSubtitute');
        }
        if (this._cannotCreate) {
            writer.write('CannotCreate');
        }

        if (this._cannotDelete) {
            writer.write('CannotDelete');
        }
        if (this._cannotUpdate) {
            writer.write('CannotUpdate');
        }
        writer.write('IsConfig: ' + this.isConfig);
        writer.write('IsReady: ' + this.isReady);

        if (this.taskLabels) {
            writer.write('taskLabels: ' + JSON.stringify(this.taskLabels));
        }
        if (this.nonConcurrentLabels) {
            writer.write('nonConcurrentLabels: ' + JSON.stringify(this.nonConcurrentLabels));
        }
        if (_.keys(this._autoCreatedOwners).length > 0) {
            writer.write('Auto Created Owners:');
            writer.write(_.keys(this._autoCreatedOwners));
        }

        if (_.keys(this.config).length > 0) {
            writer.write('Config:');
            writer.write(this.config);
        }
        if (_.keys(this.runtime).length > 0) {
            writer.write('Runtime:');
            writer.write(this.runtime);
        }
        if (this.obj) {
            writer.write('Obj:');
            writer.write(this.obj);
        }
        for (const relation of _.sortBy(this.relations, (x) => x.targetDn)) {
            let relationInfo =
                '=> ' +
                relation.targetDn +
                ', Target: ' +
                JSON.stringify(relation.targetId) +
                ', Resolved: ' +
                JSON.stringify(relation.resolvedTargetId);
            if (relation.shouldIgnoreDelta) {
                relationInfo = relationInfo + ' (Ignored by delta)';
            }
            if (relation.shouldIgnoreDependency) {
                relationInfo = relationInfo + ' (Dependency ignored by processor)';
            }
            writer.write(relationInfo);
            writer.indent();
            if (relation.sourceLeg.autoCreate) {
                writer.write('Source Autocreate. Runtime:');
                writer.write(relation.sourceLeg.autoCreateRuntime);
            }
            if (relation.targetLeg.autoCreate) {
                writer.write('Target Autocreate. Runtime:');
                writer.write(relation.targetLeg.autoCreateRuntime);
            }
            writer.unindent();
        }
        writer.unindent();
        writer.write();
    }

    acceptObj(obj: any): Promise<any> {
        this._logger.verbose('Accepting %s object:', this.dn, obj);
        return Promise.resolve()
            .then(() => {
                this._obj = obj;
                this._id = this.meta.extractId(obj);
                return Promise.resolve(this.meta.extractConfig(obj));
            })
            .then((result) => {
                this._setConfig(result);
            })
            .then(() => {
                this._runtime = this.meta.extractRuntime(obj);
                this._logger.verbose('Accepted runtime for %s object:', this.dn, this._runtime);
            })
            .then(() => {
                const subInfo = this.meta.getSubstituteInfo(this.id);
                if (subInfo) {
                    this.markSubstitute();
                }
            })
            .then(() => {
                this.root.deleteRelationsByOwner(this.dn);
                const relationConstructor = new RelationConstructor(this);
                this.meta.extractRelations(relationConstructor);
                return MyPromise.serial(relationConstructor.relationInfos, (x) => this._acceptRelationInfo(x));
            })
            .then(() => {
                return this.performPostProcess();
            })
            .then(() => this._performReadyCheck())
            .then(() => this);
    }

    private _acceptRelationInfo(info: RelationInfo): any {
        const sourceMeta = this.meta.root.get(info.sourceSectionName!);
        const targetMeta = this.meta.root.get(info.targetSectionName!);
        const rel = new ConfigRelation(
            this.root,
            info.ownerDn,
            sourceMeta,
            info.sourceNaming,
            targetMeta,
            info.targetNaming,
            info.targetId,
            info.runtime,
        );
        rel.sourceLeg.setupAutoCreate(info.sourceAutoCreate, info.sourceAutoCreateRuntime);
        rel.targetLeg.setupAutoCreate(info.targetAutoCreate, info.targetAutoCreateRuntime);
        if (info.shouldIgnoreDelta) {
            rel.markIgnoreDelta();
        }
        if (info.shouldIgnoreDependency) {
            rel.markIgnoreDependency();
        }
        return this.root.registerRelation(rel);
    }

    markSubstitute(): this {
        this._isSubtitute = true;
        return this.markCannotCreate().markCannotDelete().markCannotUpdate();
    }

    markCannotCreate(): this {
        this._cannotCreate = true;
        return this;
    }

    markCannotDelete(): this {
        this._cannotDelete = true;
        return this;
    }

    markCannotUpdate(): this {
        this._cannotUpdate = true;
        return this;
    }

    static createNew(root: Config, meta: ConfigSectionMeta, naming: any): ConfigItem {
        const item = new ConfigItem(root, meta, naming);
        return item;
    }
}
