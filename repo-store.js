const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const shell = require('shelljs');
const Promise = require('the-promise');

class RepoStore
{
    constructor(logger)
    {
        this._logger = logger;

        this._repositories = {};
        this._skipFileOutput = false;

        this.setupRepository('dirtyRepos', 'DIRTY REPOSITORIES').markDoNotPersist();
        this.setupRepository('suppressed', 'SUPPRESSED DIRTY RESOURCES').markDoNotPersist();
    }

    get repos() {
        return _.keys(this._repositories);
    }

    setSkipFileOutput(value) {
        this._skipFileOutput = value;
    }

    getRepository(name)
    {
        var info = this._getRepositoryInfo(name);
        return info.data;
    }

    setupRepository(name, info, processorCb, processorLevels)
    {
        var repoInfo = {
            name: name,
            info: info,
            processorCb: processorCb,
            processorLevels: processorLevels,
            data: {},
            markDoNotPersist: () => {
                repoInfo.doNotPersist = true;
                return repoInfo;
            }
        };
        this._repositories[name] = repoInfo;
        return repoInfo;
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
        this._logger.info('[_processDirtyRepo] entries: ', entries);
        entries = entries.filter(x => !this._shouldDelayDirtyProcessing(repoName, x));
        this._logger.info('[_processDirtyRepo] filtered entries: ', entries);

        return Promise.resolve()
            .then(() => this.delete('dirtyRepos', [repoName]))
            .then(() => Promise.serial(entries, x => repoInfo.processorCb.apply(null, x)))
            ;
    }

    unmarkDirtyRepo(name, path)
    {
        var repoInfo = this._getRepositoryInfo(name);
        var fullPath = _.concat(name, path);
        this.delete('dirtyRepos', fullPath, true);
    }

    markDirtyRepo(name, path)
    {
        if (this._shouldDelayDirtyProcessing(name, path))
        {
            var fullPath = _.concat(name, path);
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

    outputRepository(name)
    {
        // if (this._skipFileOutput) {
        //     return;
        // }

        this._logger.info('[outputRepository] %s...', name);

        var info = this._getRepositoryInfo(name);
        this._logger.info('%s: ', info.info, info.data);

        this._outputRepositoryToFile(name);
    }

    _outputRepositoryToFile(name)
    {
        if (this._skipFileOutput) {
            return;
        }

        var fileName = 'logs_berlioz/task-metadata-' + name + '.json';

        var writer = fs.createWriteStream(fileName);
        var info = this._getRepositoryInfo(name);
        writer.write(JSON.stringify(info.data, null, 4));
    }

    outputRepositories()
    {
        for(var name of this.repos)
        {
            this.outputRepository(name);
        }
    }

    saveToFile(dirPath)
    {
        shell.mkdir('-p', dirPath);

        return Promise.serial(_.keys(this._repositories), x => this._saveRepoToFile(x, dirPath));
    }

    _saveRepoToFile(name, dirPath)
    {
        var repoInfo = this._getRepositoryInfo(name);
        if (repoInfo.doNotPersist) {
            return;
        }
        return new Promise((resolve, reject) => {
            var filePath = path.join(dirPath, name + '.json');
            var persistenceData = repoInfo.data;
            fs.writeFile(filePath, JSON.stringify(persistenceData, null, 4), (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    }

    loadFromFile(dirPath)
    {
        return Promise.serial(_.keys(this._repositories), x => this._loadRepoFromFile(x, dirPath))
            .then(() => this.outputRepositories());
    }

    _loadRepoFromFile(name, dirPath)
    {
        var repoInfo = this._getRepositoryInfo(name);
        if (repoInfo.doNotPersist) {
            return;
        }
        return new Promise((resolve, reject) => {
            var filePath = path.join(dirPath, name + '.json');
            this._logger.verbose('[loadRepoFromFile] %s from %s...', name, filePath);
            if (!fs.existsSync(filePath)) {
                resolve();
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                var persistenceData = JSON.parse(data);
                this._logger.verbose('[loadRepoFromFile] %s data:', name, persistenceData);

                repoInfo.data = persistenceData;
                resolve();
            });
        });
    }

}

module.exports = RepoStore;
