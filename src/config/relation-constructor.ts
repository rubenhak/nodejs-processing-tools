import _ from 'the-lodash';

import { ConfigMeta } from './meta';

export class RelationInfo {
    ownerDn: string;
    sourceAutoCreate: boolean;
    targetAutoCreate: boolean;

    sourceSectionName?: string;
    sourceNaming?: any;
    sourceAutoCreateRuntime?: any;
    targetSectionName?: string;
    targetNaming?: any;
    targetAutoCreateRuntime?: any;
    targetId?: any;
    runtime?: any;
    shouldIgnoreDelta?: boolean;
    shouldIgnoreDependency?: boolean;

    constructor(ownerDn: string) {
        this.ownerDn = ownerDn;
        this.sourceAutoCreate = false;
        this.targetAutoCreate = false;
    }

    _setupSource(metaName: string, naming: any): this {
        this.sourceSectionName = metaName;
        this.sourceNaming = naming;
        ConfigMeta.validateNaming(this.sourceNaming);
        return this;
    }

    setupSourceAutoCreate(runtime: any): this {
        this.sourceAutoCreate = true;
        this.sourceAutoCreateRuntime = runtime;
        return this;
    }

    markIgnoreDelta(): this {
        this.shouldIgnoreDelta = true;
        return this;
    }

    markIgnoreDependency(): this {
        this.shouldIgnoreDependency = true;
        return this;
    }

    _setupTarget(metaName: string, naming: any): this {
        this.targetSectionName = metaName;
        this.targetNaming = naming;
        ConfigMeta.validateNaming(this.targetNaming);
        return this;
    }

    setupTargetAutoCreate(runtime: any): this {
        this.targetAutoCreate = true;
        this.targetAutoCreateRuntime = runtime;
        return this;
    }

    setupTargetId(value: any): this {
        this.targetId = value;
        return this;
    }

    setupRuntime(runtime: any): this {
        this.runtime = runtime;
        return this;
    }
}

export class RelationConstructor {
    private _item: any;
    private _relations: RelationInfo[];

    constructor(item: any) {
        this._item = item;
        this._relations = [];
    }

    get item(): any {
        return this._item;
    }

    get meta(): any {
        return this._item.meta;
    }

    get naming(): any {
        return this._item.naming;
    }

    get dn(): string {
        return this._item.dn;
    }

    get id(): any {
        return this._item.id;
    }

    get obj(): any {
        return this._item.obj;
    }

    get config(): any {
        return this._item.config;
    }

    get runtime(): any {
        return this._item.runtime;
    }

    get relationInfos(): RelationInfo[] {
        return this._relations;
    }

    relation(targetSectionName: string, targetNaming?: any): RelationInfo {
        if (_.isNullOrUndefined(targetNaming)) {
            const dnInfo = this.meta.root.breakDn(targetSectionName);
            targetSectionName = dnInfo.metaName;
            targetNaming = dnInfo.naming;
        }

        const relationInfo = new RelationInfo(this._item.dn);
        relationInfo._setupSource(this._item.meta.name, this._item.naming);
        relationInfo._setupTarget(targetSectionName, targetNaming);
        this._relations.push(relationInfo);
        return relationInfo;
    }

    inverseRelation(sourceSectionName: string, sourceNaming?: any): RelationInfo {
        if (_.isNullOrUndefined(sourceNaming)) {
            const dnInfo = this.meta.root.breakDn(sourceSectionName);
            sourceSectionName = dnInfo.metaName;
            sourceNaming = dnInfo.naming;
        }

        const relationInfo = new RelationInfo(this._item.dn);
        relationInfo._setupSource(sourceSectionName, sourceNaming);
        relationInfo._setupTarget(this._item.meta.name, this._item.naming);
        this._relations.push(relationInfo);
        return relationInfo;
    }
}
