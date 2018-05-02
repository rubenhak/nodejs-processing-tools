const fs = require('fs');
const deepEqual = require('deep-equal')
const _ = require('lodash');
const Promise = require('the-promise');

const RootMeta = require('./meta');

class ConfigRelationLeg
{
    constructor(parent, meta, naming)
    {
        this._parent = parent;
        this._meta = meta;
        this._logger = meta.logger;

        if (!_.isArray(naming)) {
            naming = [naming];
        }
        this._naming = naming;

        RootMeta.validateNaming(this._naming);

        this._autoCreate = false;
        this._autoCreateRuntime = null;
    }

    get parent() {
        return this._parent;
    }

    get dn() {
        return this._meta.constructDn(this._naming);
    }

    get meta() {
        return this._meta;
    }

    get metaName() {
        return this.meta.name;
    }

    get naming() {
        return this._naming;
    }

    get item() {
        return this._parent.root.findDn(this.dn);
    }

    get resolvedItem() {
        return this._parent.root.resolveDn(this.dn);
    }

    get autoCreate() {
        return this._autoCreate;
    }

    get autoCreateRuntime() {
        return this._autoCreateRuntime;
    }

    setupAutoCreate(enabled, runtime) {
        this._autoCreate = enabled;
        this._autoCreateRuntime = runtime;
    }

    exportToData()
    {
        return {
            meta: this._meta.name,
            naming: this._naming,
            autoCreate: this._autoCreate,
            autoCreateRuntime: this._autoCreateRuntime
        }
    }

    static createFromData(data, parent, rootMeta)
    {
        var leg = new ConfigRelationLeg(parent, rootMeta.get(data.meta), data.naming);
        leg._autoCreate = data.autoCreate;
        leg._autoCreateRuntime = data.autoCreateRuntime;
        return leg;
    }
}

class ConfigRelation
{
    constructor(root, ownerDn, sourceMeta, sourceNaming, targetMeta, targetNaming, targetId, runtime)
    {
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

    get ownerDn() {
        return this._ownerDn;
    }

    get root() {
        return this._root;
    }

    get runtime() {
        return this._runtime;
    }

    get shouldIgnoreDelta() {
        return this._shouldIgnoreDelta;
    }

    get shouldIgnoreDependency() {
        return this._shouldIgnoreDependency;
    }

    get legs() {
        return this._legs;
    }

    get sourceLeg() {
        return this._sourceLeg;
    }

    get targetLeg() {
        return this._targetLeg;
    }

    // Source
    get sourceItem() {
        return this._sourceLeg.item;
    }

    get resolvedSourceItem() {
        return this._sourceLeg.resolvedItem;
    }

    get sourceMeta() {
        return this._sourceLeg.meta;
    }

    get sourceMetaName() {
        return this._sourceLeg.metaName;
    }

    get sourceNaming() {
        return this._sourceLeg.naming;
    }

    get sourceDn() {
        return this._sourceLeg.dn;
    }

    // target
    get targetMeta() {
        return this._targetLeg.meta;
    }

    get targetMetaName() {
        return this._targetLeg.metaName;
    }

    get targetNaming() {
        return this._targetLeg.naming;
    }

    get targetDn() {
        return this._targetLeg.dn;
    }

    get targetId() {
        return this._targetId;
    }

    get targetItem() {
        return this.targetLeg.item;
    }

    get resolvedTargetItem() {
        return this.targetLeg.resolvedItem;
    }

    get resolvedTargetId() {
        var item = this.resolvedTargetItem;
        if (item) {
            return item._id;
        }
        return null;
    }

    markIgnoreDelta() {
        this._shouldIgnoreDelta = true;
    }

    markIgnoreDependency() {
        this._shouldIgnoreDependency = true;
    }

    exportToData()
    {
        return {
            ownerDn: this._ownerDn,
            sourceLeg: this._sourceLeg.exportToData(),
            targetLeg: this._targetLeg.exportToData(),
            targetId: this._targetId,
            runtime: this._runtime,
            shouldIgnoreDelta: this._shouldIgnoreDelta,
            shouldIgnoreDependency: this._shouldIgnoreDependency
        };
    }

    static createFromData(root, data)
    {
        var relation = new ConfigRelation(root, data.ownerDn,
                                        root.meta.get(data.sourceLeg.meta), data.sourceLeg.naming,
                                        root.meta.get(data.targetLeg.meta), data.targetLeg.naming,
                                        data.targetId,
                                        data.runtime);
        relation.sourceLeg.setupAutoCreate(data.sourceLeg.autoCreate, data.sourceLeg.autoCreateRuntime);
        relation.targetLeg.setupAutoCreate(data.targetLeg.autoCreate, data.targetLeg.autoCreateRuntime);
        relation._shouldIgnoreDelta = data.shouldIgnoreDelta;
        relation._shouldIgnoreDependency = data.shouldIgnoreDependency;
        return relation;
    }

    static createNew(root, ownerDn, sourceMeta, sourceNaming, targetMeta, targetNaming, targetId, runtime)
    {
        var relation = new ConfigRelation(root, ownerDn, sourceMeta, sourceNaming, targetMeta, targetNaming, targetId, runtime)
        return relation;
    }

}

module.exports = ConfigRelation;
