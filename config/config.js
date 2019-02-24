const fs = require('fs');
const Promise = require('the-promise');
const _ = require('the-lodash');

const ConfigSection = require('./section');
const ConfigRelation = require('./relation');

class Config
{
    constructor(meta, resolutionConfig)
    {
        this._meta = meta;
        this._logger = meta.logger;
        this._resolutionConfig = resolutionConfig;
        this._sections = {};
        for(var sectionMeta of this._meta.sections) {
            this._sections[sectionMeta.name] = new ConfigSection(this, sectionMeta);
        }
        this._relationOwners = {};
        this._relations = {};
    }

    get meta() {
        return this._meta;
    }

    get logger() {
        return this._logger;
    }

    get resolutionConfig() {
        return this._resolutionConfig;
    }

    get isConfig() {
        if (this._resolutionConfig) {
            return true;
        }
        return false;
    }

    registerRelation(relation)
    {
        if (relation.sourceDn in this._relations) {
            var existings = this._relations[relation.sourceDn].filter(x => x.targetDn == relation.targetDn);
            if (existings.length > 0) {
                return Promise.resolve(existings[0]);
            }
        }

        this._logger.verbose('Creating relation %s => %s', relation.sourceDn, relation.targetDn);
        // if (relation.sourceDn in this._relations) {
        //     var existings = this._relations[relation.sourceDn].filter(x => x.targetDn == relation.targetDn);
        //     for(var relation of existings) {
        //         this.deleteRelation(relation)
        //     }
        // }

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

    _ensurePresent(relationLeg)
    {
        return Promise.resolve(this._extractRelationLegItem(relationLeg))
            .then(item => {
                if (!item) {
                    return;
                }
                if (relationLeg.autoCreate) {
                    item.addOwner(relationLeg.parent.ownerDn);
                }
            });
    }

    _extractRelationLegItem(relationLeg)
    {
        var meta = relationLeg.meta;
        var item = this.findDn(relationLeg.dn);

        if (this.isConfig)
        {
            if (relationLeg.autoCreate) {
                this._logger.verbose('AutoCreating Config %s...', relationLeg.dn, relationLeg.autoCreateRuntime);
                item = this.section(meta.name).create(relationLeg.naming);
            }
            return item;
        }
        else
        {
            if (relationLeg.autoCreate) {
                if (item) {
                    if (relationLeg.autoCreateRuntime) {
                        if (_.fastDeepEqual(item.runtime, relationLeg.autoCreateRuntime)) {
                            return item;
                        } else {
                            this._logger.verbose('Runtimes are different for %s. ItemRuntime: %s, RelationRuntime: %s...', relationLeg.dn, JSON.stringify(item.runtime), JSON.stringify(relationLeg.autoCreateRuntime));
                        }
                    } else {
                        return item;
                    }
                }

                this._logger.verbose('AutoCreating %s...', relationLeg.dn, relationLeg.autoCreateRuntime);
                if (meta._onQuery)
                {
                    var id = meta._extractIdFromNaming(relationLeg.naming, relationLeg.autoCreateRuntime);
                    return Promise.resolve(meta.query(id, relationLeg.autoCreateRuntime))
                        .then(obj => this.section(meta.name).mergeItem(obj, relationLeg.autoCreateRuntime));
                }
            }
        }

    }

    getOwnedRelations(ownerDn)
    {
        if (ownerDn in this._relationOwners) {
            return this._relationOwners[ownerDn].slice();
        }
        return [];
    }

    getTargetRelations(sourceDn)
    {
        if (!(sourceDn in this._relations)) {
            return [];
        }
        return this._relations[sourceDn].slice();
    }

    getSourceRelations(targetDn, sourceMetaName)
    {
        var result = [];
        for(var relations of _.values(this._relations))
        {
            for(var relation of relations)
            {
                if (relation.targetDn == targetDn)
                {
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

    deleteRelationsByOwner(ownerDn)
    {
        for (var relation of this.getOwnedRelations(ownerDn))
        {
            this.deleteRelation(relation);
        }
    }

    deleteRelation(relation)
    {
        for (var leg of relation.legs) {
            if (leg.autoCreate) {
                var item = leg.item;
                if (item) {
                    item.deleteOwner(relation.ownerDn);
                }
            }
        }

        _.remove(this._relationOwners[relation.ownerDn], x => x === relation);
        if (this._relationOwners[relation.ownerDn].length == 0)
        {
            delete this._relationOwners[relation.ownerDn];
        }

        _.remove(this._relations[relation.sourceDn], x => x === relation);
        if (this._relations[relation.sourceDn].length == 0)
        {
            delete this._relations[relation.sourceDn];
        }
    }

    section(name)
    {
        if (!(name in this._sections)) {
            throw new Error('No section ' + name + ' present.');
        }
        return this._sections[name];
    }

    extract(filter)
    {
        var sections = this._meta.sections;
        if (filter) {
            sections = sections.filter(filter);
        }
        var sectionGroups = _.groupBy(sections, x => x._priority);
        var priorities = _.keys(sectionGroups);
        priorities = _.sortBy(priorities, x => parseInt(x));
        return Promise.serial(priorities, x => this._extractSections(x, sectionGroups[x]))
            .then(() => this._performPostProcess());
    }

    _extractSections(priority, sections)
    {
        this._logger.verbose('[_extractSections] Priority: %s...', priority);
        return Promise.serial(sections, sectionMeta => this._extractSection(sectionMeta))
    }

    _performPostProcess()
    {
        return Promise.serial(_.values(this._sections), section => section._performPostProcess());
    }

    performAutoConfig()
    {
        return Promise.serial(_.values(this._sections), section => section.performAutoConfig());
    }

    findDn(dn) {
        var dnInfo = this._meta.breakDn(dn);
        if (!dnInfo) {
            return null;
        }
        return this.section(dnInfo.metaName).find(dn);
    }

    resolveDn(dn) {
        if (this._resolutionConfig) {
            return this._resolutionConfig.resolveDn(dn);
        }
        return this.findDn(dn);
    }

    find(metaName, naming) {
        var meta = this._meta.get(metaName);
        var dn = meta.constructDn(naming);
        return this.findDn(dn);
    }

    resolve(metaName, naming) {
        var meta = this._meta.get(metaName);
        var dn = meta.constructDn(naming);
        return this.resolveDn(dn);
    }

    produceDelta(base)
    {
        var delta = {};
        for(var sectionMeta of this._meta.sections) {
            var mySection = this.section(sectionMeta.name);
            var baseSection = base.section(sectionMeta.name);
            mySection.produceDelta(delta, baseSection);
        }
        var toBeRecreatedItems = [];
        for(var sectionMeta of this._meta.sections) {
            if (sectionMeta._onUpdateRecreateCb) {
                for(var itemDn of _.keys(delta))
                {
                    if (this._meta.breakDn(itemDn).meta == sectionMeta)
                    {
                        if (delta[itemDn].status == 'update')
                        {
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

    markItemRecreateInDelta(delta, item)
    {
        return this._markItemsRecreate(delta, [item]);
    }

    _markItemsRecreate(delta, items)
    {
        if (items.length == 0) {
            return;
        }
        var toBeRecreatedItems = [];
        for(var item of items)
        {
            this._markItemRecreate(delta, item, toBeRecreatedItems);
        }
        this._markItemsRecreate(delta, toBeRecreatedItems);
    }

    _markItemRecreate(delta, item, toBeRecreatedItems)
    {
        this._logger.verbose('[_markItemRecreate] %s', item.dn);
        var currDeltaData = null;
        if (delta[item.dn]) {
            if (delta[item.dn].status == 'recreate') {
                return;
            }
            if (delta[item.dn].status == 'update') {
                currDeltaData = delta[item.dn].delta;
            }
        }
        item.addToDeltaDict(delta, 'recreate', currDeltaData);

        var relations = this.getSourceRelations(item.dn);
        for(var relation of relations)
        {
            this._logger.verbose('[_markItemRecreate] ?? %s', relation.sourceDn);

            var sourceItem = relation.sourceItem;
            if (sourceItem.meta._onUpdateRecreateCb)
            {
                if (sourceItem.meta._onUpdateRecreateCb(null))
                {
                    if (sourceItem.dn in delta) {
                        if (delta[sourceItem.dn].status == 'update') {
                            this._logger.verbose('[_markItemRecreate] -> %s', sourceItem.dn);
                            toBeRecreatedItems.push(sourceItem);
                        }
                    }
                    else {
                        this._logger.verbose('[_markItemsRecreate] => %s', sourceItem.dn);
                        toBeRecreatedItems.push(sourceItem);
                    }
                }
            }
        }
    }


    exportToData()
    {
        var data = {
            sections: {

            },
            relations: [

            ]
        };
        for(var sectionMeta of this._meta.sections)
        {
            var section = this._sections[sectionMeta.name];
            data.sections[section.meta.name] = section.exportToData();
        }
        for(var relations of _.values(this._relations))
        {
            for(var relation of relations) {
                var relationData = relation.exportToData();
                data.relations.push(relationData);
            }
        }
        return data;
    }

    loadFromData(data)
    {
        return Promise.resolve()
            .then(() => {
                return Promise.serial(_.keys(data.sections), x => {
                    var section = this._sections[x];
                    if (!section) {
                        throw new Error('Invalid section ' + x);
                    }
                    return section.loadFromData(data.sections[x]);
                });
            })
            .then(() => {
                return Promise.serial(data.relations, relationData => {
                    var relation = ConfigRelation.createFromData(this, relationData);
                    return this.registerRelation(relation);
                });
            });
    }

    exportToFile(path)
    {
        var data = this.exportToData();
        fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    }

    loadFromFile(path)
    {
        var dataStr = fs.readFileSync(path);
        var data = JSON.parse(dataStr);
        return this.loadFromData(data);
    }

    _extractSection(sectionMeta)
    {
        var section = this._sections[sectionMeta.name];
        return section.queryAll();
    }

    debugOutputToFile(fileName)
    {
        var writer = this._logger.outputStream(fileName);
        if (!writer) {
            return Promise.resolve();
        }

        for(var sectionName of this._meta.sections.map(x => x.name).sort())
        {
            writer.writeHeader(sectionName);
            this._sections[sectionName].debugOutputToFile(writer);
        }
        writer.write();
        writer.write();
        for(var relationList of _.orderBy(_.values(this._relations), ['sourceDn', 'targetDn'])) {
            for (var relation of relationList) {
                writer.indent();
                writer.write(relation.sourceDn + ' => ' + relation.targetDn + ', Target: ' + JSON.stringify(relation.targetId) + ', Resolved: ' + JSON.stringify(relation.resolvedTargetId));
                if (relation.relation) {
                    writer.indent();
                    writer.write('Runtime:');
                    writer.write(relation.relation);
                    writer.unindent();
                }
                if (relation.sourceLeg.autoCreate)
                {
                    writer.indent();
                    writer.write('Source Autocreate. Runtime:');
                    writer.write(relation.sourceLeg.autoCreateRuntime);
                    writer.unindent();
                }
                if (relation.targetLeg.autoCreate)
                {
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

    output()
    {
        for(var sectionMeta of this._meta.sections)
        {
            var section = this._sections[sectionMeta.name];
            section.output();
        }
    }

}

module.exports = Config;
