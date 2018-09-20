const _ = require('the-lodash');
const Promise = require('the-promise');

const ConfigItem = require('./item');
const ConfigRelation = require('./relation');

class ConfigSection
{
    constructor(root, meta)
    {
        this._root = root;
        this._logger = meta.logger;
        this._meta = meta;
        this._itemDict = {};
    }

    get root() {
        return this._root;
    }

    get meta() {
        return this._meta;
    }

    get items() {
        return _.values(this._itemDict);
    }

    queryAll()
    {
        if (!this.meta._queryAll) {
            return Promise.resolve();
        }
        this._logger.info('Querying section %s', this.meta.name);
        return Promise.resolve(this.meta._queryAll())
            .then(result => {
                this._logger.verbose('Querying section %s, Result received.', this.meta.name);
                this._logger.silly('Querying section %s, Result:', this.meta.name, result);
                return this._mergeResult(result);
            });
    }

    find(dn) {
        if (dn in this._itemDict) {
            return this._itemDict[dn];
        }
        return null;
    }

    findByNaming(naming)
    {
        var dn = this.meta.constructDn(naming);
        return this.find(dn);
    }

    removeAll()
    {
        for(var item of this.items) {
            item.remove();
        }
    }

    remove(dn) {
        var item = this.find(dn);
        if (item) {
            this.root.deleteRelationsByOwner(item.dn);
            delete this._itemDict[item.dn];
            _.remove(this._items, x => x.dn === item.dn);
        }
    }


    create(naming)
    {
        this._logger.silly('Adding %s %s', this.meta.name, naming);
        var item = ConfigItem.createNew(this._root, this.meta, naming);
        this._logger.silly('    Added %s. isConfig=%s', item.dn, this.root.isConfig);
        return this._insertItem(item);
    }

    produceDelta(delta, baseSection)
    {
        if (this.meta.ignoreDelta) {
            return;
        }
        var baseItems = baseSection.items;
        for(var item of this.items) {
            var baseItem = _.find(baseItems, x => x.dn == item.dn);
            if (baseItem) {
                var itemDelta = item.produceDelta(baseItem);
                if (itemDelta) {
                    item.addToDeltaDict(delta, 'update', itemDelta);
                }
                _.remove(baseItems, x => x === baseItem);
            } else {
                item.addToDeltaDict(delta, 'create');
            }
        }
        for(var item of baseItems) {
            item.addToDeltaDict(delta, 'delete');
        }
    }

    _mergeResult(result)
    {
        if (!result) {
            return;
        }
        //this._logger.info('Section %s query result:', section.meta.name, result);
        return Promise.serial(result, obj => this.mergeItem(obj));
    }

    mergeItem(obj, autoCreateRuntime)
    {
        if (!obj) {
            this._logger.error('Could not merge %s item since it is null', this.meta.name);
            return;
        }
        this._logger.verbose('Merging item to section %s', this.meta.name, obj);
        var naming = this.meta.extractNaming(obj, autoCreateRuntime);
        this._logger.verbose('New Item naming %s', naming);
        var item = ConfigItem.createNew(this._root, this.meta, naming);
        this._logger.verbose('New Item: %s', item.dn);
        item = this._insertItem(item);
        return item.acceptObj(obj);
    }

    _insertItem(item)
    {
        if (item.dn in this._itemDict) {
            return this._itemDict[item.dn];
        }
        this._itemDict[item.dn] = item;
        return item;
    }

    cloneFrom(otherConfig, skipRelations, relationFilter)
    {
        return Promise.serial(otherConfig.section(this.meta.name).items,
                              x => this.cloneSingleItemFrom(x, skipRelations, relationFilter));
    }

    cloneSingleItemFrom(otherItem, skipRelations, relationFilter)
    {
        return Promise.resolve()
            .then(() => {
                var item = this.create(otherItem.naming);
                item.cloneFrom(otherItem);
            })
            .then(() => {
                if(skipRelations) {
                    return;
                }
                return Promise.serial(otherItem.getOwnedRelations(), otherRelation => {
                    if (relationFilter) {
                        if ((!_.includes(relationFilter, otherRelation.sourceMeta.name)) &&
                            (!_.includes(relationFilter, otherRelation.targetMeta.name)))
                            {
                                return;
                            }
                    }
                    var relation = new ConfigRelation(this.root,
                                                      otherItem.dn,
                                                      otherRelation.sourceMeta, otherRelation.sourceNaming,
                                                      otherRelation.targetMeta, otherRelation.targetNaming,
                                                      otherRelation.targetId,
                                                      otherRelation.runtime);
                    relation.sourceLeg.setupAutoCreate(otherRelation.sourceLeg.autoCreate, otherRelation.sourceLeg.autoCreateRuntime);
                    relation.targetLeg.setupAutoCreate(otherRelation.targetLeg.autoCreate, otherRelation.targetLeg.autoCreateRuntime);
                    if (otherRelation.shouldIgnoreDelta) {
                        relation.markIgnoreDelta();
                    }
                    if (otherRelation.shouldIgnoreDependency) {
                        relation.markIgnoreDependency();
                    }
                    return this.root.registerRelation(relation);
                })
            });
    }

    _performPostProcess()
    {
        return Promise.serial(this.items, item => item.performPostProcess());
    }

    performAutoConfig()
    {
        if (this.meta._autoConfig) {
            return Promise.serial(this.items, item => item.performAutoConfig());
        }
    }

    exportToData()
    {
        var data = {
        };
        for (var item of this.items) {
            var itemData = item.exportToData();
            if (itemData) {
                data[item.dn] = itemData;
            }
        }
        return data;
    }

    loadFromData(data)
    {
        for(var itemData of _.values(data))
        {
            var item = this.create(itemData.naming);
            item.loadFromData(itemData);
        }
    }

    outputDetailed()
    {
        for(var item of this.items)
        {
            item.outputDetailed();
        }
    }

    output()
    {
        for(var item of this.items)
        {
            item.output();
        }
    }

    debugOutputToFile(writer)
    {
        for(var item of _.sortBy(this.items, x => x.dn))
        {
            item.debugOutputToFile(writer);
            writer.write();
        }
    }

}

module.exports = ConfigSection;
