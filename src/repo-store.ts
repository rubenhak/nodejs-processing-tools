import _ from 'the-lodash';
import { MyPromise } from 'the-promise';
import * as fs from 'fs';
import * as path from 'path';

import { ILogger } from './logger';

const shell = require('shelljs');

export type DirtyProcessorCb = (...args: any[]) => any;

interface RepoInfo {
    name: string;
    info: string;
    doNotPersist: boolean;
    processorCb: DirtyProcessorCb | null;
    processorLevels: number | null;
    isLoaded: boolean;
    origData: Record<string, any>;
    data: Record<string, any>;
}

export interface RepoBuilder {
    description(value: string): RepoBuilder;
    handleDirty(cb: DirtyProcessorCb, levels: number): RepoBuilder;
    markDoNotPersist(): RepoBuilder;
}

export class RepoStore {
    private _logger: ILogger;
    private _name: string;
    private _persistenceDir: string | null;
    private _repositories: Record<string, RepoInfo>;

    constructor(logger: ILogger, name: string) {
        this._logger = logger;
        this._name = name;
        this._persistenceDir = null;

        this._repositories = {};

        this.setupRepository('dirtyRepos').description('DIRTY REPOSITORIES').markDoNotPersist();
        this.setupRepository('suppressed').description('SUPPRESSED DIRTY RESOURCES').markDoNotPersist();
    }

    setupPersistence(dir: string): void {
        this._persistenceDir = dir;
    }

    get repos(): string[] {
        return _.keys(this._repositories);
    }

    getRepository(name: string): Record<string, any> {
        const repoInfo = this._getRepositoryInfo(name);
        this._accessRepo(repoInfo);
        return repoInfo.data;
    }

    setupRepository(name: string): RepoBuilder {
        let repoInfo = this._repositories[name];
        if (!repoInfo) {
            repoInfo = {
                name: name,
                info: '',
                doNotPersist: false,
                processorCb: null,
                processorLevels: null,
                isLoaded: false,
                origData: {},
                data: {},
            };
            this._repositories[name] = repoInfo;
        }

        const builder: RepoBuilder = {
            description: (value: string) => {
                repoInfo.info = value;
                return builder;
            },
            handleDirty: (cb: DirtyProcessorCb, levels: number) => {
                repoInfo.processorCb = cb;
                repoInfo.processorLevels = levels;
                return builder;
            },
            markDoNotPersist: () => {
                repoInfo.doNotPersist = true;
                return builder;
            },
        };

        return builder;
    }

    at(name: string, keyPath: string[]): any {
        let dict = this.getRepository(name);
        for (const key of keyPath) {
            if (key in dict) {
                dict = dict[key];
            } else {
                dict[key] = {};
                dict = dict[key];
            }
        }
        return dict;
    }

    get(name: string, keyPath: string[]): any {
        let dict = this.getRepository(name);
        for (const key of keyPath) {
            if (key in dict) {
                dict = dict[key];
            } else {
                return null;
            }
        }
        return dict;
    }

    set(name: string, keyPath: string[], value: any): void {
        const parentPath = _.take(keyPath, keyPath.length - 1);
        const parent = this.at(name, parentPath);
        const childName = keyPath[keyPath.length - 1];
        parent[childName] = value;
    }

    delete(name: string, keyPath: string[]): void {
        const dict = this.getRepository(name);
        this._deleteKeyInDict(dict, keyPath);
    }

    private _deleteKeyInDict(dict: Record<string, any>, keyPath: string[]): void {
        if (_.isEmpty(keyPath)) {
            return;
        }

        const key = _.first(keyPath)!;
        keyPath = _.drop(keyPath, 1);
        if (key in dict) {
            if (_.isEmpty(keyPath)) {
                delete dict[key];
            } else {
                const childDict = dict[key];
                this._deleteKeyInDict(childDict, keyPath);
                if (_.isEmpty(childDict)) {
                    delete dict[key];
                }
            }
        }
    }

    loop(name: string, keyPath: string[], callback: (key: string, value: any) => any): Promise<any> | undefined {
        const dict = this.get(name, keyPath);
        if (!dict) {
            return;
        }

        const keys = _.keys(dict);
        return MyPromise.serial(keys, (key) => callback(key, dict[key]));
    }

    private _flattenKeys(name: string, initialPath: string[], level: number | null): string[][] {
        const dict = this.get(name, initialPath);
        return this._flattenDict(dict, level);
    }

    private _flattenDict(
        dict: Record<string, any>,
        level: number | null,
        currentPath?: string[],
        results?: string[][],
    ): string[][] {
        if (!currentPath) {
            currentPath = [];
        }
        if (!results) {
            results = [];
        }
        if (level == 0) {
            results.push(currentPath);
        } else {
            for (const key of _.keys(dict)) {
                const newPath = _.concat(currentPath, key);
                this._flattenDict(dict[key], (level as number) - 1, newPath, results);
            }
        }
        return results;
    }

    markRepoSuppressProcess(name: string, path: string[], delay: boolean): Promise<any> | undefined {
        const fullPath = _.concat(name, path);
        if (delay) {
            this.at('suppressed', fullPath);
        } else {
            this.delete('suppressed', fullPath);
            return this._processDirtyRepo(name);
        }
    }

    private _processDirtyRepo(repoName: string): Promise<any> {
        const repoInfo = this._getRepositoryInfo(repoName);

        let entries = this._flattenKeys('dirtyRepos', [repoName], repoInfo.processorLevels);
        this._logger.info('[_processDirtyRepo] %s, entries: ', repoName, entries);
        entries = entries.filter((x) => !this._shouldDelayDirtyProcessing(repoName, x));
        this._logger.info('[_processDirtyRepo] %s, filtered entries: ', repoName, entries);

        return Promise.resolve()
            .then(() => this.delete('dirtyRepos', [repoName]))
            .then(() => MyPromise.serial(entries, (x) => repoInfo.processorCb!.apply(null, x)));
    }

    unmarkDirtyRepo(name: string, path: string[]): void {
        const fullPath = _.concat(name, path);
        this._logger.info('[unmarkDirtyRepo] %s: ', name, path);
        this.delete('dirtyRepos', fullPath);
    }

    markDirtyRepo(name: string, path: string[]): any {
        if (this._shouldDelayDirtyProcessing(name, path)) {
            const fullPath = _.concat(name, path);
            this._logger.info('[markDirtyRepo] %s: ', name, path);
            this.set('dirtyRepos', fullPath, true);
        } else {
            const repoInfo = this._getRepositoryInfo(name);
            return repoInfo.processorCb!.apply(null, path);
        }
    }

    private _shouldDelayDirtyProcessing(name: string, path: string[]): boolean {
        for (let i = 0; i <= path.length; i++) {
            const fullPath = _.concat(name, _.take(path, i));
            const value = this.get('suppressed', fullPath);
            if (value) {
                return true;
            }
        }
        return false;
    }

    private _getRepositoryInfo(name: string): RepoInfo {
        if (!(name in this._repositories)) {
            throw new Error('Invalid repository ' + name);
        }
        return this._repositories[name];
    }

    outputRepositories(): Promise<any> {
        return MyPromise.serial(this.repos, (x) => this.outputRepository(x));
    }

    outputRepository(name: string): any {
        this._logger.silly('[outputRepository] %s::%s...', this._name, name);
        return this._outputRepositoryToFile(name);
    }

    private _outputRepositoryToFile(name: string): any {
        const fileName = this._name + '-' + name + '.json';
        const info = this.getRepository(name);
        return this._logger.outputFile(fileName, info.data);
    }

    persistStore(): Promise<any> | undefined {
        if (!this._persistenceDir) {
            return;
        }

        shell.mkdir('-p', this._persistenceDir);
        return MyPromise.serial(_.keys(this._repositories), (x) => this._saveRepoToFile(x));
    }

    private _saveRepoToFile(name: string): Promise<void> | undefined {
        const repoInfo = this._getRepositoryInfo(name);
        if (repoInfo.doNotPersist) {
            return;
        }
        if (!repoInfo.isLoaded) {
            return;
        }
        if (_.fastDeepEqual(repoInfo.origData, repoInfo.data)) {
            return;
        }
        return MyPromise.construct<void>((resolve, reject) => {
            const filePath = path.join(this._persistenceDir!, name + '.json');
            const persistenceData = repoInfo.data;
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

    private _accessRepo(repoInfo: RepoInfo): void {
        if (!this._persistenceDir) {
            return;
        }
        if (repoInfo.doNotPersist) {
            return;
        }
        if (repoInfo.isLoaded) {
            return;
        }
        this._loadRepoFromFile(repoInfo);
        repoInfo.isLoaded = true;
    }

    private _loadRepoFromFile(repoInfo: RepoInfo): void {
        const filePath = path.join(this._persistenceDir!, repoInfo.name + '.json');
        if (fs.existsSync(filePath)) {
            const contents = fs.readFileSync(filePath, 'utf8');
            const persistenceData = JSON.parse(contents);
            this._logger.silly('[_loadRepoFromFile] %s data:', repoInfo.name, persistenceData);

            repoInfo.data = persistenceData;
            repoInfo.origData = _.cloneDeep(persistenceData);
        } else {
            repoInfo.data = {};
            repoInfo.origData = {};
        }
    }
}
