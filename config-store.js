var _ = require('lodash');

class ConfigStore
{
    constructor(logger)
    {
        this._logger = logger;
        this._repo = {};
        this._setupRepo(this._repo);
    }

    setValue(path, property, value)
    {
        var repo = this._getRepo(this._repo, path);
        this._setValueInRepo(repo, property, value);
    }

    resolveValue(path, property)
    {
        return this._resolveValue(this._repo, path, property);
    }

    _resolveValue(repo, path, property)
    {
        if (path.length == 0) {
            return this._getValueFromRepo(repo, property);
        }

        var head = _.head(path);
        if (head in repo.children) {
            var value = this._resolveValue(repo.children[head], _.drop(path), property);
            if (value != null) {
                return value;
            }
        }

        return this._getValueFromRepo(repo, property);
    }

    _getRepo(repo, path)
    {
        if (path.length == 0) {
            return repo;
        }
        var head = _.head(path);
        if (!(head in repo.children)) {
            var newChild = {};
            this._setupRepo(newChild);
            repo.children[head] = newChild;
        }
        repo = repo.children[head];
        return this._getRepo(repo, _.drop(path));
    }

    _setValueInRepo(repo, property, value)
    {
        repo.config[property] = value;
    }

    _getValueFromRepo(repo, property)
    {
        if (property in repo.config) {
            return repo.config[property];
        }
        return null;
    }

    _setupRepo(repo)
    {
        repo.config = {};
        repo.children = {};
    }

    output()
    {
        this._logger.info('ConfigStore: ', this._repo);
    }
}

module.exports = ConfigStore;
