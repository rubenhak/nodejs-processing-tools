import _ from 'the-lodash';

import type { ConfigMeta } from './index';
import type { ConfigDeltaItem } from '../delta-item';
import { DeltaItemStatus } from '../types';
import { ILogger } from '../../logger';

export type MetaCallback = (...args: any[]) => any;

export interface SubstituteInfo {
    dn: string;
    naming: any;
    id: any;
}

export class ConfigSectionMeta {
    private _parent: ConfigMeta;
    private _logger: ILogger;
    private _name: string;
    _autoConfig: MetaCallback | null;
    _checkReady: MetaCallback | null;
    _onPostCreate: MetaCallback | null;
    _onRelationCreate: Record<string, MetaCallback>;
    _onRelationDelete: Record<string, MetaCallback>;
    _onPostRelationCreate: Record<string, MetaCallback>;
    _actions: Record<string, MetaCallback>;
    _ignoreDelta: boolean;
    _useDefaultsForDelta: boolean;
    _onCheckIgnoreDelta: MetaCallback | null;
    _params: Record<string, any>;
    _substitutes: SubstituteInfo[];
    _substituteIdMap: Record<string, SubstituteInfo>;
    _priority: number;

    _extractIdFromNaming?: MetaCallback;
    _queryAll?: MetaCallback;
    _onPostQueryAll?: MetaCallback;
    _onQuery?: MetaCallback;
    _extractNaming?: MetaCallback;
    _extractId?: MetaCallback;
    _extractConfig?: MetaCallback;
    _extractRuntime?: MetaCallback;
    _extractRelations?: MetaCallback;
    _onCreate?: MetaCallback;
    _onUpdate?: MetaCallback;
    _onUpdateRecreateCb?: MetaCallback;
    _onDelete?: MetaCallback;
    _postProcess?: MetaCallback;

    constructor(parent: ConfigMeta, name: string) {
        this._parent = parent;
        this._logger = parent.logger;
        this._name = name;
        this._autoConfig = null;
        this._checkReady = null;
        this._onPostCreate = null;
        this._onRelationCreate = {};
        this._onRelationDelete = {};
        this._onPostRelationCreate = {};
        this._actions = {};
        this._ignoreDelta = false;
        this._useDefaultsForDelta = false;
        this._onCheckIgnoreDelta = null;
        this._params = {};
        this._substitutes = [];
        this._substituteIdMap = {};
        this._priority = 100;
    }

    get ignoreDelta(): boolean {
        return this._ignoreDelta;
    }

    get logger(): ILogger {
        return this._logger;
    }

    get root(): ConfigMeta {
        return this._parent;
    }

    get name(): string {
        return this._name;
    }

    get useDefaultsForDelta(): boolean {
        return this._useDefaultsForDelta;
    }

    setParam(name: string, value: any): this {
        this._params[name] = value;
        return this;
    }

    getParam(name: string): any {
        if (name in this._params) {
            return this._params[name];
        }
        return null;
    }

    setConfigArrayMetadata(key: string, value: any): this {
        return this.setParam(_.toUpper(key) + '_CONFIG_ARRAY_METADATA', value);
    }

    getConfigArrayMetadata(key: string): any {
        return this.getParam(_.toUpper(key) + '_CONFIG_ARRAY_METADATA');
    }

    markIgnoreDelta(): this {
        this._ignoreDelta = true;
        return this;
    }

    onExtractIdFromNaming(callback: MetaCallback): this {
        if (this._extractIdFromNaming) {
            throw new Error('Already present');
        }
        this._extractIdFromNaming = callback;
        return this;
    }

    priority(value: number): this {
        this._priority = value;
        return this;
    }

    onQueryAll(callback: MetaCallback): this {
        if (this._queryAll) {
            throw new Error('Already present');
        }
        this._queryAll = callback;
        return this;
    }

    onPostQueryAll(callback: MetaCallback): this {
        if (this._onPostQueryAll) {
            throw new Error('Already present');
        }
        this._onPostQueryAll = callback;
        return this;
    }

    onQuery(callback: MetaCallback): this {
        if (this._onQuery) {
            throw new Error('Already present');
        }
        this._onQuery = callback;
        return this;
    }

    onExtractNaming(callback: MetaCallback): this {
        if (this._extractNaming) {
            throw new Error('Already present');
        }
        this._extractNaming = callback;
        return this;
    }

    onExtractId(callback: MetaCallback): this {
        if (this._extractId) {
            throw new Error('Already present');
        }
        this._extractId = callback;
        return this;
    }

    onExtractConfig(callback: MetaCallback): this {
        if (this._extractConfig) {
            throw new Error('Already present');
        }
        this._extractConfig = callback;
        return this;
    }

    onExtractRuntime(callback: MetaCallback): this {
        if (this._extractRuntime) {
            throw new Error('Already present');
        }
        this._extractRuntime = callback;
        return this;
    }

    onExtractRelations(callback: MetaCallback): this {
        if (this._extractRelations) {
            throw new Error('Already present');
        }
        this._extractRelations = callback;
        return this;
    }

    onCheckReady(callback: MetaCallback): this {
        if (this._checkReady) {
            throw new Error('Already present');
        }
        this._checkReady = callback;
        return this;
    }

    onAutoConfig(callback: MetaCallback): this {
        if (this._autoConfig) {
            throw new Error('Already present');
        }
        this._autoConfig = callback;
        return this;
    }

    onCreate(callback: MetaCallback): this {
        if (this._onCreate) {
            throw new Error('Already present');
        }
        this._onCreate = callback;
        return this;
    }

    onUpdate(callback: MetaCallback): this {
        if (this._onUpdate) {
            throw new Error('Already present');
        }
        this._onUpdate = callback;
        return this;
    }

    onUpdateRecreate(callback: MetaCallback): this {
        this._onUpdateRecreateCb = callback;
        return this;
    }

    onDelete(callback: MetaCallback): this {
        if (this._onDelete) {
            throw new Error('Already present');
        }
        this._onDelete = callback;
        return this;
    }

    onPostCreate(callback: MetaCallback): this {
        if (this._onPostCreate) {
            throw new Error('Already present');
        }
        this._onPostCreate = callback;
        return this;
    }

    onRelationCreate(name: string, callback: MetaCallback): this {
        if (this._onRelationCreate[name]) {
            throw new Error('Already present');
        }
        this._onRelationCreate[name] = callback;
        return this;
    }

    onRelationDelete(name: string, callback: MetaCallback): this {
        if (this._onRelationDelete[name]) {
            throw new Error('Already present');
        }
        this._onRelationDelete[name] = callback;
        return this;
    }

    onPostRelationCreate(name: string, callback: MetaCallback): this {
        if (this._onPostRelationCreate[name]) {
            throw new Error('Already present');
        }
        this._onPostRelationCreate[name] = callback;
        return this;
    }

    onPostProcess(callback: MetaCallback): this {
        if (this._postProcess) {
            throw new Error('Already present');
        }
        this._postProcess = callback;
        return this;
    }

    onCheckIgnoreDelta(callback: MetaCallback): this {
        if (this._onCheckIgnoreDelta) {
            throw new Error('Already present');
        }
        this._onCheckIgnoreDelta = callback;
        return this;
    }

    done(): ConfigMeta {
        return this._parent;
    }

    setupAction(name: string, callback: MetaCallback): void {
        this._actions[name] = callback;
    }

    /*****/

    create(deltaItem: any): any {
        if (this._onCreate) {
            return this._onCreate(deltaItem);
        }
    }

    update(deltaItem: any): any {
        if (this._onUpdate) {
            return this._onUpdate(deltaItem);
        }
    }

    createOrUpdate(deltaItem: ConfigDeltaItem): any {
        if (deltaItem.status == DeltaItemStatus.Create) {
            return this.create(deltaItem);
        } else if (deltaItem.status == DeltaItemStatus.Update) {
            return this.update(deltaItem);
        }
    }

    extractNaming(obj: any, runtime?: any): any {
        const id = this.extractId(obj);
        if (id) {
            const subInfo = this.getSubstituteInfo(id);
            if (subInfo) {
                return _.clone(subInfo.naming);
            }
        }
        if (!this._extractNaming) {
            return null;
        }
        const naming = this._extractNaming(obj, runtime);
        return naming;
    }

    constructDn(naming: any): string {
        return this.root.constructDn(this._name, naming);
    }

    extractId(obj: any): any {
        if (!this._extractId) {
            return null;
        }
        return this._extractId(obj);
    }

    extractConfig(obj: any): any {
        if (!this._extractConfig) {
            return {};
        }
        return this._extractConfig(obj);
    }

    extractRuntime(obj: any): any {
        if (!this._extractRuntime) {
            return {};
        }
        return this._extractRuntime(obj);
    }

    extractRelations(item: any): void {
        if (this._extractRelations) {
            this._extractRelations(item);
        }
    }

    postProcess(item: any): any {
        if (!this._postProcess) {
            return null;
        }
        this._logger.silly('Performing postprocess for %s ...', item.dn);
        return this._postProcess(item);
    }

    relationCreate(item: any, target: any): Promise<boolean> {
        this._logger.verbose('Creating relation %s => %s :: %s ...', item.dn, target.dn, JSON.stringify(target.id));

        if (target.meta.name in this._onRelationCreate) {
            return Promise.resolve(this._onRelationCreate[target.meta.name](item, target)).then(() => true);
        }

        return Promise.resolve(false);
    }

    relationDelete(item: any, target: any, runtime?: any): Promise<boolean> {
        this._logger.verbose('Deleting relation %s => %s :: %s ...', item.dn, target.dn, JSON.stringify(target.id));

        if (target.meta.name in this._onRelationDelete) {
            return Promise.resolve(this._onRelationDelete[target.meta.name](item, target, runtime)).then(() => true);
        }

        return Promise.resolve(false);
    }

    postRelationCreate(item: any, target: any): any {
        if (target.meta.name in this._onPostRelationCreate) {
            return this._onPostRelationCreate[target.meta.name](item, target);
        }
    }

    query(id: any, runtime?: any): any {
        if (!this._onQuery) {
            return Promise.resolve();
        } else {
            return this._onQuery(id, runtime);
        }
    }

    markUseDefaultsForDelta(): this {
        this._useDefaultsForDelta = true;
        return this;
    }

    substitute(naming: any, id: any): void {
        const info: SubstituteInfo = {
            dn: this.constructDn(naming),
            naming: naming,
            id: id,
        };
        this._substitutes.push(info);
        this._substituteIdMap[info.id] = info;
    }

    getSubstituteInfo(id: any): SubstituteInfo | undefined {
        return this._substituteIdMap[id];
    }
}
