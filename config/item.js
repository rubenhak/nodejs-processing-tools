const fs = require('fs');
const Promise = require('the-promise');
const _ = require('lodash');
const deepEqual = require('deep-equal');

const ConfigRelation = require('./relation');
const RelationConstructor = require('./relation-constructor');
const RootMeta = require('./meta');

class ConfigItem
{
    constructor(root, meta, naming)
    {
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

        RootMeta.validateNaming(this.naming);

        this._obj = null;
        this._id = null;
    }

    get logger() {
        return this._logger;
    }

    exportToData()
    {
        // if (_.keys(this._autoCreatedOwners).length > 0) {
        //     return null;
        // }

        var data = {
            naming: this._naming,
            config: this._config,
            runtime: this._runtime,
            obj: this._obj,
            id: this._id,
            autoCreatedOwners: this._autoCreatedOwners
        };
        return data;
    }

    loadFromData(data)
    {
        this._config = data.config;
        this._obj = data.obj;
        this._runtime = data.runtime;
        this._id = data.id;
        this._autoCreatedOwners = data.autoCreatedOwners;
    }

    get root() {
        return this._root;
    }

    get isConfig() {
        return this.root.isConfig;
    }

    get meta() {
        return this._meta;
    }

    get naming() {
        return this._naming;
    }

    get dn() {
        return this._dn;
    }

    get config() {
        return this._config;
    }

    get runtime() {
        return this._runtime;
    }

    get resolved() {
        if (this.isConfig) {
            var item = this._root.resolveDn(this.dn);
            return item;
        }
        return this;
    }

    get obj() {
        if (this.isConfig) {
            var item = this._root.resolveDn(this.dn);
            if (item) {
                return item.obj;
            }
        }
        return this._obj;
    }

    get id() {
        if (this.isConfig) {
            var item = this._root.resolveDn(this.dn);
            if (item) {
                return item.id;
            }
        }
        return this._id;
    }

    get relations() {
        return this.root.getTargetRelations(this.dn);
    }

    addOwner(relationOwnerDn)
    {
        this._autoCreatedOwners[relationOwnerDn] = true;
    }

    deleteOwner(relationOwnerDn)
    {
        delete this._autoCreatedOwners[relationOwnerDn];
        if (_.keys(this._autoCreatedOwners).length == 0) {
            this.remove();
        }
    }

    remove()
    {
        this.root.section(this.meta.name).remove(this.dn);
    }

    cloneFrom(otherItem)
    {
        this._config = _.cloneDeep(otherItem._config);
        this._runtime = _.cloneDeep(otherItem._runtime);
        this._obj = otherItem._obj;
        this._id = otherItem._id;
    }

    deleteRelation(targetDn)
    {
        var relation = _.head(this.relations.filter(x => x.targetDn == targetDn));
        if (relation) {
            this.root.deleteRelation(relation);
        }
    }

    deleteAllRelations()
    {
        for(var relation of this.relations) {
            this.root.deleteRelation(relation);
        }
    }

    deleteRelationsByMeta(targetMetaName)
    {
        var relations = this.relations.filter(x => x.targetMetaName == targetMetaName);
        for(var relation of relations) {
            this.root.deleteRelation(relation);
        }
    }

    relation(targetSectionName, targetNaming, targetId, runtime)
    {
        if (targetSectionName instanceof ConfigItem) {
            return this.relation(targetSectionName.meta.name, targetSectionName.naming);
        }

        var targetMeta = this.meta.root.get(targetSectionName);
        var rel = new ConfigRelation(this.root, this.dn, this.meta, this.naming, targetMeta, targetNaming, targetId, runtime);
        return this.root.registerRelation(rel);
    }

    relationAutoCreatable(targetSectionName, targetNaming, targetAutocreateRuntime)
    {
        var targetMeta = this.meta.root.get(targetSectionName);
        var rel = new ConfigRelation(this.root, this.dn, this.meta, this.naming, targetMeta, targetNaming, null, null);
        rel.targetLeg.setupAutoCreate(true, targetAutocreateRuntime);
        return this.root.registerRelation(rel);
    }

    inverseRelationAutoCreatable(sourceSectionName, sourceNaming, sourceAutocreateRuntime)
    {
        var sourceMeta = this.meta.root.get(sourceSectionName);
        var rel = new ConfigRelation(this.root, this.dn, sourceMeta, sourceNaming, this.meta, this.naming, null, null);
        rel.sourceLeg.setupAutoCreate(true, sourceAutocreateRuntime);
        return this.root.registerRelation(rel);
    }

    findRelation(targetSectionName)
    {
        return _.head(this.findRelations(targetSectionName));
    }

    findRelations(targetSectionName)
    {
        var relations = this.relations.filter(x => x.targetMetaName == targetSectionName);
        return relations;
    }

    getRelationByTargetDn(targetSectionName, dn)
    {
        var relations = this.relations.filter(x => x.targetDn == dn);
        return _.head(relations);
    }

    getRelationByTargetNaming(targetSectionName, naming)
    {
        var dn = this.meta.root.constructDn(targetSectionName, naming);
        return this.getRelationByTargetDn(targetSectionName, dn);
    }

    setConfig(name, value)
    {
        this._config[name] = value;
        return this;
    }

    setRuntime(value)
    {
        this._runtime = value;
        return this;
    }

    produceDelta(baseItem)
    {
        var deltaConfigs = {};
        var baseConfigs = _.clone(baseItem._config);
        for(var key of _.keys(this._config)) {
            var myConfig = this._config[key];
            if (key in baseConfigs) {
                var baseConfig = baseConfigs[key];
                if (!deepEqual(myConfig, baseConfig)) {
                    deltaConfigs[key] = {
                        oldValue: baseConfig,
                        value: myConfig,
                        state: 'update'
                    };
                }
                _.unset(baseConfigs, key);
            } else {
                deltaConfigs[key] = {
                    value: myConfig,
                    state: 'create'
                };
            }
        }
        for (var key of _.keys(baseConfigs)) {
            var baseConfig = baseConfigs[key];
            deltaConfigs[key] = {
                oldValue: baseConfig,
                state: 'delete'
            };
        }

        var deltaRelations = [];
        var baseRelations = _.clone(baseItem.relations);
        var targetRelations = this.relations.filter(x => !x.shouldIgnoreDelta);
        for(var relation of targetRelations) {
            var baseRelation = _.find(baseRelations, x => x.targetDn == relation.targetDn);
            if (baseRelation) {
                if (baseRelation.targetId && relation.resolvedtargetId) {
                    if (!deepEqual(baseRelation.targetId, relation.resolvedTargetId))
                    {
                        deltaRelations.push({
                            targetMeta: relation.targetMeta.name,
                            relation: relation.targetDn,
                            currentId: baseRelation.targetId,
                            resolvedTargetId: relation.resolvedTargetId,
                            state: 'update'
                        });
                    }
                }
                _.remove(baseRelations, x => x === baseRelation);
            } else {
                deltaRelations.push({
                    targetMeta: relation.targetMeta.name,
                    relation: relation.targetDn,
                    state: 'create'
                });
            }
        }
        for(var baseRelation of baseRelations) {
            deltaRelations.push({
                targetMeta: baseRelation.targetMeta.name,
                relation: baseRelation.targetDn,
                runtime: baseRelation.runtime,
                state: 'delete'
            });
        }

        if (_.keys(deltaConfigs).length + deltaRelations.length > 0) {
            return {
                configs: deltaConfigs,
                relations: deltaRelations
            }
        }
        return null;
    }

    refresh()
    {
        if (!this.isConfig) {
            if (this.meta._onQuery)
            {
                return Promise.resolve(this.meta._onQuery(this.id, this.runtime))
                    .then(obj => this.acceptObj(obj))
                    ;
            }
        }
        return Promise.resolve();
    }

    executeAction(name, args)
    {
        var action = this.meta._actions[name];
        if (!action) {
            throw new Error('Missing action: ' + name + ' on ' + this.meta.name);
        }
        var actualArgs = [this];
        if (_.isArray(args)) {
            for(var x of args) {
                actualArgs.push(x);
            }
        } else {
            actualArgs.push(args);
        }
        return action.apply(null, actualArgs);
    }

    performPostProcess()
    {
        return this.meta.postProcess(this);
    }

    performAutoConfig(action)
    {
        if (this.meta._autoConfig) {
            this._logger.info('Running autoconfig on %s...', this.dn);
            return this.meta._autoConfig(this, action);
        }
    }

    outputDetailed()
    {
        this._logger.info('Section %s, Dn: %s, item:', this.meta.name, this.dn, {obj: this._obj, config: this._config, id: this._id } );
        for (var relation of this.relations) {
            this._logger.info('Relation %s => %s, Target: %s, Resolved: %s', this.dn, relation.targetDn, JSON.stringify(relation.targetId), JSON.stringify(relation.resolvedTargetId) );
        }
    }

    output()
    {
        this._logger.info('Item: %s, %s, isConfig: %s', this.dn, this.resolvedTargetId, this.isConfig );
        for (var relation of this.relations) {
            this._logger.info('    => %s, Target: %s, Resolved: %s', relation.targetDn, JSON.stringify(relation.targetId), JSON.stringify(relation.resolvedTargetId) );
        }
        this._logger.info('    Config%s', '', this._config );
        this._logger.info('    Runtime%s', '', this._runtime );
    }


    debugOutputToFile(writer)
    {
        writer.write('    -) ' + this.dn + '\n');
        writer.write('        Naming: ' + JSON.stringify(this.naming) + '\n');
        if (this.id)
        {
            writer.write('         Id: ' + JSON.stringify(this.id) + '\n');
        }
        writer.write('        IsConfig: ' + this.isConfig + '\n');
        if (this.taskLabels) {
            writer.write('        taskLabels: ' + JSON.stringify(this.taskLabels) + '\n');
        }
        if (this.nonConcurrentLabels) {
            writer.write('        nonConcurrentLabels: ' + JSON.stringify(this.nonConcurrentLabels) + '\n');
        }
        if (_.keys(this._autoCreatedOwners).length > 0) {
            writer.write('        Auto Created Owners:\n');
            for (var x of _.keys(this._autoCreatedOwners)) {
                writer.write('            ' + x + '\n');
            }
        }

        if (_.keys(this.config).length > 0)
        {
            writer.write('        Config:\n');
            for (var x of JSON.stringify(this.config, null, 2).split('\n')) {
                writer.write('            ' + x + '\n');
            }
        }
        if (_.keys(this.runtime).length > 0)
        {
            writer.write('        Runtime:\n');
            for (var x of JSON.stringify(this.runtime, null, 2).split('\n')) {
                writer.write('            ' + x + '\n');
            }
        }
        if (this.obj)
        {
            writer.write('        Obj: \n');
            for (var x of JSON.stringify(this.obj, null, 2).split('\n')) {
                writer.write('           ' + x + '\n');
            }
        }
        for (var relation of _.sortBy(this.relations, x => x.targetDn)) {
            var relationInfo = '        => ' + relation.targetDn + ', Target: ' + JSON.stringify(relation.targetId) + ', Resolved: ' + JSON.stringify(relation.resolvedTargetId);
            if (relation.shouldIgnoreDelta) {
                relationInfo = relationInfo + ' (Ignored by delta)';
            }
            if (relation.shouldIgnoreDependency) {
                relationInfo = relationInfo + ' (Dependency ignored by processor)';
            }
            writer.write(relationInfo + '\n');
            if (relation.sourceLeg.autoCreate)
            {
                writer.write('           Source Autocreate. Runtime:\n');
                if (relation.sourceLeg.autoCreateRuntime) {
                    for (var x of JSON.stringify(relation.sourceLeg.autoCreateRuntime, null, 2).split('\n')) {
                        writer.write('           ' + x + '\n');
                    }
                }
            }
            if (relation.targetLeg.autoCreate)
            {
                writer.write('           Target Autocreate. Runtime:\n');
                if (relation.targetLeg.autoCreateRuntime) {
                    for (var x of JSON.stringify(relation.targetLeg.autoCreateRuntime, null, 2).split('\n')) {
                        writer.write('           ' + x + '\n');
                    }
                }
            }
        }

    }

    acceptObj(obj)
    {
        this._logger.verbose('Accepting %s object:', this.dn, obj);
        this._obj = obj;
        this._id = this.meta.extractId(obj);
        this._config = this.meta.extractConfig(obj);
        this._runtime = this.meta.extractRuntime(obj);
        this._logger.verbose('Accepted runtime for %s object:', this.dn, this._runtime);

        this.root.deleteRelationsByOwner(this.dn);
        var relationConstructor = new RelationConstructor(this);
        this.meta.extractRelations(relationConstructor);
        return Promise.serial(relationConstructor.relationInfos, info => {
            var sourceMeta = this.meta.root.get(info.sourceSectionName);
            var targetMeta = this.meta.root.get(info.targetSectionName);
            var rel = new ConfigRelation(this.root,
                                         info.ownerDn,
                                         sourceMeta, info.sourceNaming,
                                         targetMeta, info.targetNaming,
                                         info.targetId,
                                         info.runtime);
            rel.sourceLeg.setupAutoCreate(info.sourceAutoCreate, info.sourceAutoCreateRuntime);
            rel.targetLeg.setupAutoCreate(info.targetAutoCreate, info.targetAutoCreateRuntime);
            if (info.shouldIgnoreDelta) {
                rel.markIgnoreDelta();
            }
            if (info.shouldIgnoreDependency) {
                rel.markIgnoreDependency();
            }
            return this.root.registerRelation(rel);
        })
        .then(() => {
            return this.performPostProcess();
        })
        .then(() => this);
    }

    static createNew(root, meta, naming)
    {
        var item = new ConfigItem(root, meta, naming);
        return item;
    }

}

module.exports = ConfigItem;