const Promise = require('the-promise');
const _ = require('the-lodash');

class ConfigSectionMeta
{
    constructor(parent, name)
    {
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

    get ignoreDelta() {
        return this._ignoreDelta;
    }

    get logger() {
        return this._logger;
    }

    get root() {
        return this._parent;
    }

    get name() {
        return this._name;
    }

    get useDefaultsForDelta() {
        return this._useDefaultsForDelta;
    }

    setParam(name, value)
    {
        this._params[name] = value;
        return this; 
    }

    getParam(name) {
        if (name in this._params) {
            return this._params[name]
        }
        return null;
    }

    setConfigArrayMetadata(key, value)
    {
        return this.setParam(_.toUpper(key) + "_CONFIG_ARRAY_METADATA", value);
    }

    getConfigArrayMetadata(key)
    {
        return this.getParam(_.toUpper(key) + "_CONFIG_ARRAY_METADATA");
    }

    markIgnoreDelta()
    {
        this._ignoreDelta = true;
        return this;
    }

    onExtractIdFromNaming(callback)
    {
        if (this._extractIdFromNaming) {
            throw new Error('Already present');
        }
        this._extractIdFromNaming = callback;
        return this;
    }

    priority(value)
    {
        this._priority = value;
        return this;    
    }

    onQueryAll(callback)
    {
        if (this._queryAll) {
            throw new Error('Already present');
        }
        this._queryAll = callback;
        return this;
    }
    
    onPostQueryAll(callback)
    {
        if (this._onPostQueryAll) {
            throw new Error('Already present');
        }
        this._onPostQueryAll = callback;
        return this;
    }
    
    onQuery(callback)
    {
        if (this._onQuery) {
            throw new Error('Already present');
        }
        this._onQuery = callback;
        return this;
    }

    onExtractNaming(callback)
    {
        if (this._extractNaming) {
            throw new Error('Already present');
        }
        this._extractNaming = callback;
        return this;
    }

    onExtractId(callback)
    {
        if (this._extractId) {
            throw new Error('Already present');
        }
        this._extractId = callback;
        return this;
    }

    onExtractConfig(callback)
    {
        if (this._extractConfig) {
            throw new Error('Already present');
        }
        this._extractConfig = callback;
        return this;
    }

    onExtractRuntime(callback)
    {
        if (this._extractRuntime) {
            throw new Error('Already present');
        }
        this._extractRuntime = callback;
        return this;
    }

    onExtractRelations(callback)
    {
        if (this._extractRelations) {
            throw new Error('Already present');
        }
        this._extractRelations = callback;
        return this;
    }

    onCheckReady(callback)
    {
        if (this._checkReady) {
            throw new Error('Already present');
        }
        this._checkReady = callback;
        return this;
    }

    onAutoConfig(callback)
    {
        if (this._autoConfig) {
            throw new Error('Already present');
        }
        this._autoConfig = callback;
        return this;
    }

    onCreate(callback)
    {
        if (this._onCreate) {
            throw new Error('Already present');
        }
        this._onCreate = callback;
        return this;
    }

    onUpdate(callback)
    {
        if (this._onUpdate) {
            throw new Error('Already present');
        }
        this._onUpdate = callback;
        return this;
    }

    onUpdateRecreate(callback)
    {
        this._onUpdateRecreateCb = callback;
        return this;
    }

    onDelete(callback)
    {
        if (this._onDelete) {
            throw new Error('Already present');
        }
        this._onDelete = callback;
        return this;
    }

    onPostCreate(callback)
    {
        if (this._onPostCreate) {
            throw new Error('Already present');
        }
        this._onPostCreate = callback;
        return this;
    }

    onRelationCreate(name, callback)
    {
        if (this._onRelationCreate[name]) {
            throw new Error('Already present');
        }
        this._onRelationCreate[name] = callback;
        return this;
    }

    onRelationDelete(name, callback)
    {
        if (this._onRelationDelete[name]) {
            throw new Error('Already present');
        }
        this._onRelationDelete[name] = callback;
        return this;
    }

    onPostRelationCreate(name, callback)
    {
        if (this._onPostRelationCreate[name]) {
            throw new Error('Already present');
        }
        this._onPostRelationCreate[name] = callback;
        return this;
    }

    onPostProcess(callback)
    {
        if (this._postProcess) {
            throw new Error('Already present');
        }
        this._postProcess = callback;
        return this;
    }

    onCheckIgnoreDelta(callback)
    {
        if (this._onCheckIgnoreDelta) {
            throw new Error('Already present');
        }
        this._onCheckIgnoreDelta = callback;
        return this;
    }


    done()
    {
        return this._parent;
    }

    setupAction(name, callback)
    {
        this._actions[name] = callback;
    }


    /*****/

    create(deltaItem)
    {
        if (this._onCreate) {
            return this._onCreate(deltaItem);
        }
    }

    update(deltaItem)
    {
        if (this._onUpdate) {
            return this._onUpdate(deltaItem);
        }
    }

    createOrUpdate(deltaItem)
    {
        if (deltaItem.status == 'create')
        {
            return this.create(deltaItem);
        }
        else if (deltaItem.status == 'update')
        {
            return this.update(deltaItem);
        }
    }

    extractNaming(obj, runtime)
    {
        var id = this.extractId(obj);
        if (id) {
            var subInfo = this.getSubstituteInfo(id);
            if (subInfo) {
                return _.clone(subInfo.naming);
            }
        }
        if (!this._extractNaming) {
            return null;
        }
        var naming = this._extractNaming(obj, runtime);
        return naming;
    }

    constructDn(naming)
    {
        return this.root.constructDn(this._name, naming);
    }

    extractId(obj)
    {
        if (!this._extractId) {
            return null;
        }
        return this._extractId(obj);
    }

    extractConfig(obj)
    {
        if (!this._extractConfig) {
            return {};
        }
        return this._extractConfig(obj);
    }

    extractRuntime(obj)
    {
        if (!this._extractRuntime) {
            return {};
        }
        return this._extractRuntime(obj);
    }

    extractRelations(item)
    {
        if (this._extractRelations) {
            this._extractRelations(item);
        }
    }

    postProcess(item)
    {
        if (!this._postProcess) {
            return null;
        }
        this._logger.silly('Performing postprocess for %s ...', item.dn);
        return this._postProcess(item);
    }

    relationCreate(item, target)
    {
        this._logger.verbose('Creating relation %s => %s :: %s ...', item.dn, target.dn, JSON.stringify(target.id));

        if (target.meta.name in this._onRelationCreate) {
            return Promise.resolve(this._onRelationCreate[target.meta.name](item, target))
                .then(() => true);
        }

        return Promise.resolve(false);
    }

    relationDelete(item, target, runtime)
    {
        this._logger.verbose('Deleting relation %s => %s :: %s ...', item.dn, target.dn, JSON.stringify(target.id));

        if (target.meta.name in this._onRelationDelete) {
            return Promise.resolve(this._onRelationDelete[target.meta.name](item, target, runtime))
                .then(() => true);
        }

        return Promise.resolve(false);
    }

    postRelationCreate(item, target)
    {
        if (target.meta.name in this._onPostRelationCreate) {
            return this._onPostRelationCreate[target.meta.name](item, target);
        }
    }

    query(id, runtime)
    {
        if (!this._onQuery)
        {
            return Promise.resolve();
        }
        else
        {
            return this._onQuery(id, runtime);
        }
    }

    markUseDefaultsForDelta()
    {
        this._useDefaultsForDelta = true;
        return this;
    }

    substitute(naming, id)
    {
        var info = {
            dn: this.constructDn(naming),
            naming: naming,
            id: id
        }
        this._substitutes.push(info);
        this._substituteIdMap[info.id] = info;
    }

    getSubstituteInfo(id) {
        return this._substituteIdMap[id];
    }
}
module.exports = ConfigSectionMeta;
