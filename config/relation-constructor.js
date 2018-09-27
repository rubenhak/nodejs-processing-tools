const RootMeta = require('./meta');
const _ = require('the-lodash');

class RelationInfo
{
    constructor(ownerDn)
    {
        this.ownerDn = ownerDn;
        this.sourceAutoCreate = false;
        this.targetAutoCreate = false;
    }

    _setupSource(metaName, naming)
    {
        this.sourceSectionName = metaName;
        this.sourceNaming = naming;
        RootMeta.validateNaming(this.sourceNaming);
        return this;
    }

    setupSourceAutoCreate(runtime)
    {
        this.sourceAutoCreate = true;
        this.sourceAutoCreateRuntime = runtime;
        return this;
    }

    markIgnoreDelta()
    {
        this.shouldIgnoreDelta = true;
        return this;
    }

    markIgnoreDependency()
    {
        this.shouldIgnoreDependency = true;
        return this;
    }

    _setupTarget(metaName, naming)
    {
        this.targetSectionName = metaName;
        this.targetNaming = naming;
        RootMeta.validateNaming(this.targetNaming);
        return this;
    }

    setupTargetAutoCreate(runtime)
    {
        this.targetAutoCreate = true;
        this.targetAutoCreateRuntime = runtime;
        return this;
    }

    setupTargetId(value)
    {
        this.targetId = value;
        return this;
    }

    setupRuntime(runtime)
    {
        this.runtime = runtime;
        return this;
    }
}

class RelationConstructor
{
    constructor(item)
    {
        this._item = item;
        this._relations = [];
    }

    get item() {
        return this._item;
    }

    get meta() {
        return this._item.meta;
    }

    get naming() {
        return this._item.naming;
    }

    get dn() {
        return this._item.dn;
    }

    get id() {
        return this._item.id;
    }

    get obj() {
        return this._item.obj;
    }

    get config() {
        return this._item.config;
    }

    get runtime() {
        return this._item.runtime;
    }

    get relationInfos() {
        return this._relations;
    }

    relation(targetSectionName, targetNaming)
    {
        if (_.isNullOrUndefined(targetNaming)) {
            var dnInfo = this.meta.root.breakDn(targetSectionName);
            targetSectionName = dnInfo.metaName;
            targetNaming = dnInfo.naming;
        }

        var relationInfo = new RelationInfo(this._item.dn);
        relationInfo._setupSource(this._item.meta.name, this._item.naming);
        relationInfo._setupTarget(targetSectionName, targetNaming);
        this._relations.push(relationInfo);
        return relationInfo;
    }

    inverseRelation(sourceSectionName, sourceNaming)
    {
        if (_.isNullOrUndefined(sourceNaming)) {
            var dnInfo = this.meta.root.breakDn(sourceSectionName);
            sourceSectionName = dnInfo.metaName;
            sourceNaming = dnInfo.naming;
        }

        var relationInfo = new RelationInfo(this._item.dn);
        relationInfo._setupSource(sourceSectionName, sourceNaming);
        relationInfo._setupTarget(this._item.meta.name, this._item.naming);
        this._relations.push(relationInfo);
        return relationInfo;
    }
}

module.exports = RelationConstructor;
