
class ConfigDeltaItem
{
    constructor(item, status, delta)
    {
        this._item = item;
        this._logger = item.logger;
        this._status = status;
        this._delta = delta;
    }

    get meta() {
        return this.item.meta;
    }

    get dn() {
        return this.item.dn;
    }

    get naming() {
        return this.item.naming;
    }

    get id() {
        var baseItem = this.baseItem;
        if (baseItem) {
            return baseItem.id;
        }
        return null;
    }

    get item() {
        return this._item;
    }

    get status() {
        return this._status;
    }

    get baseItem() {
        return this.item.root.resolveDn(this.dn);
    }

    get resolutionConfig() {
        if (this.item.root.resolutionConfig) {
            return this.item.root.resolutionConfig;
        }
        return this.item.root;
    }

    get obj() {
        var baseItem = this.baseItem;
        if (baseItem) {
            return baseItem.obj;
        }
        return null;
    }

    get delta() {
        return this._delta;
    }

    get config() {
        return this.item.config;
    }

    get runtime() {
        return this.item.runtime;
    }

    findRelation(targetSectionName)
    {
        return this.item.findRelation(targetSectionName);
    }

    findRelations(targetSectionName)
    {
        return this.item.findRelations(targetSectionName);
    }

    output()
    {
        this._logger.info('DeltaItem %s to %s.', this.dn, this.status);
        if (this.baseItem) {
            this._logger.info('    HasBaseItem. id=%s.', this.id);
        }
        if (this.obj) {
            this._logger.info('    HasObjObject.');
        }
    }
}

module.exports = ConfigDeltaItem;
