const _ = require('the-lodash');
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
const Promise = require('the-promise');

class RepoStore
{
    constructor(logger, name)
    {
        this._logger = logger;
        this._name = name;
        this._persistenceDir = null;

        this._repositories = {};

        this.setupRepository('dirtyRepos').description('DIRTY REPOSITORIES').markDoNotPersist();
        this.setupRepository('suppressed').description('SUPPRESSED DIRTY RESOURCES').markDoNotPersist();
    }

    setupPersistence(dir)
    {
        this._persistenceDir = dir;
    }

    get repos() {
        return _.keys(this._repositories);
    }

    getRepository(name)
    {
        var repoInfo = this._getRepositoryInfo(name);
        this._accessRepo(repoInfo);
        return repoInfo.data;
    }

    setupRepository(name)
    {
        var repoInfo = this._repositories[name];
        if (!repoInfo) {
            repoInfo = {
                name: name,
                info: "",
                doNotPersist: false,
                processorCb: null,
                processorLevels: null,
                isLoaded: false,
                origData: {},
                data: {}
            }
            this._repositories[name] = repoInfo;
        }

        var builder = {
            description: (value) => {
                repoInfo.info = value;
                return builder;
            },
            handleDirty: (cb, levels) => {
                repoInfo.processorCb = cb;
                repoInfo.processorLevels = levels;
                return builder;
            },
            markDoNotPersist: () => {
                repoInfo.doNotPersist = true;
                return builder;
            }
        }

        return builder;
    }

    at(name, keyPath)
    {
        var dict = this.getRepository(name);
        for(var key of keyPath)
        {
            if (key in dict) {
                dict = dict[key];
            } else {
                dict[key] = {};
                dict = dict[key];
            }
        }
        return dict;
    }

    get(name, keyPath)
    {
        var dict = this.getRepository(name);
        for(var key of keyPath)
        {
            if (key in dict) {
                dict = dict[key];
            } else {
                return null;
            }
        }
        return dict;
    }

    set(name, keyPath, value)
    {
        var dict = this.getRepository(name);
        var parentPath = _.take(keyPath, keyPath.length - 1);
        var parent = this.at(name, parentPath);
        var childName = keyPath[keyPath.length - 1];
        parent[childName] = value;
    }

    delete(name, keyPath)
    {
        var dict = this.getRepository(name);
        this._deleteKeyInDict(dict, keyPath);
    }

    _deleteKeyInDict(dict, keyPath)
    {
        if (_.isEmpty(keyPath)) {
            return;
        }

        var key = _.first(keyPath);
        keyPath = _.drop(keyPath, 1);
        if (key in dict)
        {
            if (_.isEmpty(keyPath))
            {
                delete dict[key];
            }
            else
            {
                var childDict = dict[key];
                this._deleteKeyInDict(childDict, keyPath);
                if (_.isEmpty(childDict))
                {
                    delete dict[key];
                }
            }
        }
    }

    loop(name, keyPath, callback)
    {
        var dict = this.get(name, keyPath);
        if (!dict) {
            return;
        }

        var keys = _.keys(dict);
        return Promise.serial(keys, key => callback(key, dict[key]));
    }

    _flattenKeys(name, initialPath, level)
    {
        var dict = this.get(name, initialPath);
        return this._flattenDict(dict, level);
    }

    _flattenDict(dict, level, currentPath, results)
    {
        if (!currentPath) {
            currentPath = [];
        }
        if (!results) {
            results = [];
        }
        if (level == 0) {
            results.push(currentPath);
        } else {
            for(var key of _.keys(dict))
            {
                var newPath = _.concat(currentPath, key);
                this._flattenDict(dict[key], level - 1, newPath, results);
            }
        }
        return results;
    }

    markRepoSuppressProcess(name, path, delay)
    {
        var fullPath = _.concat(name, path);
        if (delay)
        {
            this.at('suppressed', fullPath);
        }
        else
        {
            this.delete('suppressed', fullPath);
            return this._processDirtyRepo(name);
        }
    }

    _processDirtyRepo(repoName)
    {
        var repoInfo = this._getRepositoryInfo(repoName);

        var entries = this._flattenKeys('dirtyRepos', [repoName], repoInfo.processorLevels);
        this._logger.info('[_processDirtyRepo] %s, entries: ', repoName, entries);
        entries = entries.filter(x => !this._shouldDelayDirtyProcessing(repoName, x));
        this._logger.info('[_processDirtyRepo] %s, filtered entries: ', repoName, entries);

        return Promise.resolve()
            .then(() => this.delete('dirtyRepos', [repoName]))
            .then(() => Promise.serial(entries, x => repoInfo.processorCb.apply(null, x)))
            ;
    }

    unmarkDirtyRepo(name, path)
    {
        var fullPath = _.concat(name, path);
        this._logger.info('[unmarkDirtyRepo] %s: ', name, path);
        this.delete('dirtyRepos', fullPath, true);
    }

    markDirtyRepo(name, path)
    {
        if (this._shouldDelayDirtyProcessing(name, path))
        {
            var fullPath = _.concat(name, path);
            this._logger.info('[markDirtyRepo] %s: ', name, path);
            this.set('dirtyRepos', fullPath, true);
        }
        else
        {
            var repoInfo = this._getRepositoryInfo(name);
            return repoInfo.processorCb.apply(null, path);
        }
    }

    _shouldDelayDirtyProcessing(name, path)
    {
        for(var i = 0; i <= path.length; i++)
        {
            var fullPath = _.concat(name, _.take(path, i));
            var value = this.get('suppressed', fullPath);
            if (value)
            {
                return true;
            }
        }
        return false;
    }

    _getRepositoryInfo(name)
    {
        if (!(name in this._repositories)) {
            throw new Error('Invalid repository ' + name);
        }
        return this._repositories[name];
    }

    outputRepositories()
    {
        return Promise.serial(this.repos, x => this.outputRepository(x));
    }
    outputRepository(name)
    {
        this._logger.silly('[outputRepository] %s::%s...', this._name, name);
        return this._outputRepositoryToFile(name);
    }
    _outputRepositoryToFile(name)
    {
        var fileName = this._name + '-' + name + '.json';
        var info = this.getRepository(name);
        return this._logger.outputFile(fileName, info.data);
    }

    persistStore()
    {
        if (!this._persistenceDir) {
            return;
        }

        shell.mkdir('-p', this._persistenceDir);
        return Promise.serial(_.keys(this._repositories), x => this._saveRepoToFile(x));
    }

    _saveRepoToFile(name)
    {
        var repoInfo = this._getRepositoryInfo(name);
        if (repoInfo.doNotPersist) {
            return;
        }
        if (!repoInfo.isLoaded) {
            return;
        }
        if (_.fastDeepEqual(repoInfo.origData, repoInfo.data)) {
            return;
        }
        return new Promise((resolve, reject) => {
            var filePath = path.join(this._persistenceDir, name + '.json');
            var persistenceData = repoInfo.data;
            fs.writeFile(filePath, JSON.stringify(persistenceData, null, 4), (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                repoInfo.origData = repoInfo.data;
                resolve();
            });
        });
    }

    _accessRepo(repoInfo)
    {
        if (!this._persistenceDir) {
            return;
        }
        if (repoInfo.doNotPersist) {
            return;
        }
        if (repoInfo.isLoaded) {
            return;
        }
        this._loadRepoFromFile(repoInfo)
        repoInfo.isLoaded = true;
    }

    _loadRepoFromFile(repoInfo)
    {
        var filePath = path.join(this._persistenceDir, repoInfo.name + '.json');
        if (fs.existsSync(filePath)) {
            var contents = fs.readFileSync(filePath);
            var persistenceData = JSON.parse(contents);
            this._logger.silly('[_loadRepoFromFile] %s data:', repoInfo.name, persistenceData);

            repoInfo.data = persistenceData;
            repoInfo.origData = _.cloneDeep(persistenceData);
        } else {
            repoInfo.data = {};
            repoInfo.origData = {};
        }
    }

}

module.exports = RepoStore;
