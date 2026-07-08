import _ from 'the-lodash';

import { ConfigMeta } from './meta';
import type { ConfigSectionMeta } from './meta/section';
import type { Config } from './config';
import { ILogger } from '../logger';

export class ConfigRelationLeg {
    private _parent: ConfigRelation;
    private _meta: ConfigSectionMeta;
    private _logger: ILogger;
    private _naming: any[];
    private _autoCreate: boolean;
    private _autoCreateRuntime: any;

    constructor(parent: ConfigRelation, meta: ConfigSectionMeta, naming: any) {
        this._parent = parent;
        this._meta = meta;
        this._logger = meta.logger;

        if (!_.isArray(naming)) {
            naming = [naming];
        }
        this._naming = naming;

        ConfigMeta.validateNaming(this._naming);

        this._autoCreate = false;
        this._autoCreateRuntime = null;
    }

    get parent(): ConfigRelation {
        return this._parent;
    }

    get dn(): string {
        return this._meta.constructDn(this._naming);
    }

    get meta(): ConfigSectionMeta {
        return this._meta;
    }

    get metaName(): string {
        return this.meta.name;
    }

    get naming(): any[] {
        return this._naming;
    }

    get item(): any {
        return this._parent.root.findDn(this.dn);
    }

    get resolvedItem(): any {
        return this._parent.root.resolveDn(this.dn);
    }

    get autoCreate(): boolean {
        return this._autoCreate;
    }

    get autoCreateRuntime(): any {
        return this._autoCreateRuntime;
    }

    setupAutoCreate(enabled: boolean, runtime: any): void {
        this._autoCreate = enabled;
        this._autoCreateRuntime = runtime;
    }

    exportToData(): any {
        return {
            meta: this._meta.name,
            naming: this._naming,
            autoCreate: this._autoCreate,
            autoCreateRuntime: this._autoCreateRuntime,
        };
    }

    static createFromData(data: any, parent: ConfigRelation, rootMeta: ConfigMeta): ConfigRelationLeg {
        const leg = new ConfigRelationLeg(parent, rootMeta.get(data.meta), data.naming);
        leg._autoCreate = data.autoCreate;
        leg._autoCreateRuntime = data.autoCreateRuntime;
        return leg;
    }
}

export class ConfigRelation {
    private _root: Config;
    private _logger: ILogger;
    private _ownerDn: string;
    private _sourceLeg: ConfigRelationLeg;
    private _targetLeg: ConfigRelationLeg;
    private _legs: ConfigRelationLeg[];
    private _targetId: any;
    private _runtime: any;
    private _shouldIgnoreDelta: boolean;
    private _shouldIgnoreDependency: boolean;

    constructor(
        root: Config,
        ownerDn: string,
        sourceMeta: ConfigSectionMeta,
        sourceNaming: any,
        targetMeta: ConfigSectionMeta,
        targetNaming: any,
        targetId: any,
        runtime: any,
    ) {
        if (targetMeta == null) {
            throw new Error('targetMeta is null');
        }
        this._root = root;
        this._logger = root.logger;

        this._ownerDn = ownerDn;

        this._sourceLeg = new ConfigRelationLeg(this, sourceMeta, sourceNaming);
        this._targetLeg = new ConfigRelationLeg(this, targetMeta, targetNaming);

        this._legs = [this._sourceLeg, this._targetLeg];

        this._targetId = targetId;
        this._runtime = runtime;
        this._shouldIgnoreDelta = false;
        this._shouldIgnoreDependency = false;
    }

    get ownerDn(): string {
        return this._ownerDn;
    }

    get root(): Config {
        return this._root;
    }

    get runtime(): any {
        return this._runtime;
    }

    get shouldIgnoreDelta(): boolean {
        return this._shouldIgnoreDelta;
    }

    get shouldIgnoreDependency(): boolean {
        return this._shouldIgnoreDependency;
    }

    get legs(): ConfigRelationLeg[] {
        return this._legs;
    }

    get sourceLeg(): ConfigRelationLeg {
        return this._sourceLeg;
    }

    get targetLeg(): ConfigRelationLeg {
        return this._targetLeg;
    }

    // Source
    get sourceItem(): any {
        return this._sourceLeg.item;
    }

    get resolvedSourceItem(): any {
        return this._sourceLeg.resolvedItem;
    }

    get sourceMeta(): ConfigSectionMeta {
        return this._sourceLeg.meta;
    }

    get sourceMetaName(): string {
        return this._sourceLeg.metaName;
    }

    get sourceNaming(): any[] {
        return this._sourceLeg.naming;
    }

    get sourceDn(): string {
        return this._sourceLeg.dn;
    }

    // target
    get targetMeta(): ConfigSectionMeta {
        return this._targetLeg.meta;
    }

    get targetMetaName(): string {
        return this._targetLeg.metaName;
    }

    get targetNaming(): any[] {
        return this._targetLeg.naming;
    }

    get targetDn(): string {
        return this._targetLeg.dn;
    }

    get targetId(): any {
        return this._targetId;
    }

    get targetItem(): any {
        return this.targetLeg.item;
    }

    get resolvedTargetItem(): any {
        return this.targetLeg.resolvedItem;
    }

    get resolvedTargetId(): any {
        const item = this.resolvedTargetItem;
        if (item) {
            return item._id;
        }
        return null;
    }

    /* Indicates wheter this relation should participate
       in config delta. */
    markIgnoreDelta(): void {
        this._shouldIgnoreDelta = true;
    }

    /* Indicates wheter this relation should be used to
       Skip and Unqualify processing of dependent items. */
    markIgnoreDependency(): void {
        this._shouldIgnoreDependency = true;
    }

    exportToData(): any {
        return {
            ownerDn: this._ownerDn,
            sourceLeg: this._sourceLeg.exportToData(),
            targetLeg: this._targetLeg.exportToData(),
            targetId: this._targetId,
            runtime: this._runtime,
            shouldIgnoreDelta: this._shouldIgnoreDelta,
            shouldIgnoreDependency: this._shouldIgnoreDependency,
        };
    }

    static createFromData(root: Config, data: any): ConfigRelation {
        const relation = new ConfigRelation(
            root,
            data.ownerDn,
            root.meta.get(data.sourceLeg.meta),
            data.sourceLeg.naming,
            root.meta.get(data.targetLeg.meta),
            data.targetLeg.naming,
            data.targetId,
            data.runtime,
        );
        relation.sourceLeg.setupAutoCreate(data.sourceLeg.autoCreate, data.sourceLeg.autoCreateRuntime);
        relation.targetLeg.setupAutoCreate(data.targetLeg.autoCreate, data.targetLeg.autoCreateRuntime);
        relation._shouldIgnoreDelta = data.shouldIgnoreDelta;
        relation._shouldIgnoreDependency = data.shouldIgnoreDependency;
        return relation;
    }

    static createNew(
        root: Config,
        ownerDn: string,
        sourceMeta: ConfigSectionMeta,
        sourceNaming: any,
        targetMeta: ConfigSectionMeta,
        targetNaming: any,
        targetId: any,
        runtime: any,
    ): ConfigRelation {
        const relation = new ConfigRelation(
            root,
            ownerDn,
            sourceMeta,
            sourceNaming,
            targetMeta,
            targetNaming,
            targetId,
            runtime,
        );
        return relation;
    }
}
