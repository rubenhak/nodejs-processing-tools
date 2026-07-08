import _ from 'the-lodash';

import { ILogger } from './logger';

interface ConfigRepoNode {
    config: Record<string, any>;
    children: Record<string, ConfigRepoNode>;
}

export class ConfigStore {
    private _logger: ILogger;
    private _repo: ConfigRepoNode;

    constructor(logger: ILogger) {
        this._logger = logger;
        this._repo = {} as ConfigRepoNode;
        this._setupRepo(this._repo);
    }

    get repo(): ConfigRepoNode {
        return this._repo;
    }

    setValue(path: string[], property: string, value: any): void {
        const repo = this._getRepo(this._repo, path);
        this._setValueInRepo(repo, property, value);
    }

    resolveValue(path: string[], property: string): any {
        return this._resolveValue(this._repo, path, property);
    }

    resolveBoolValue(path: string[], property: string): boolean {
        const value = this.resolveValue(path, property);
        if (_.isBoolean(value)) {
            return value;
        }
        if (value == 'true' || value == 'yes') {
            return true;
        }
        return false;
    }

    private _resolveValue(repo: ConfigRepoNode, path: string[], property: string): any {
        if (path.length == 0) {
            return this._getValueFromRepo(repo, property);
        }

        const head = _.head(path)!;
        if (head in repo.children) {
            const value = this._resolveValue(repo.children[head], _.drop(path), property);
            if (value != null) {
                return value;
            }
        }

        return this._getValueFromRepo(repo, property);
    }

    private _getRepo(repo: ConfigRepoNode, path: string[]): ConfigRepoNode {
        if (path.length == 0) {
            return repo;
        }
        const head = _.head(path)!;
        if (!(head in repo.children)) {
            const newChild = {} as ConfigRepoNode;
            this._setupRepo(newChild);
            repo.children[head] = newChild;
        }
        repo = repo.children[head];
        return this._getRepo(repo, _.drop(path));
    }

    private _setValueInRepo(repo: ConfigRepoNode, property: string, value: any): void {
        repo.config[property] = value;
    }

    private _getValueFromRepo(repo: ConfigRepoNode, property: string): any {
        if (property in repo.config) {
            return repo.config[property];
        }
        return null;
    }

    private _setupRepo(repo: ConfigRepoNode): void {
        repo.config = {};
        repo.children = {};
    }

    output(): void {
        this._logger.info('Config Store: ', this._repo);
    }
}
