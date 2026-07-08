import _ from 'the-lodash';
import * as fs from 'fs';
import * as Path from 'path';

import { ConfigSectionMeta } from './section';
import { ILogger } from '../../logger';

export interface DnInfo {
    metaName: string;
    meta: ConfigSectionMeta;
    naming: string[];
}

export class ConfigMeta {
    private _logger: ILogger;
    private _sections: Record<string, ConfigSectionMeta>;

    constructor(logger: ILogger) {
        this._logger = logger;
        this._sections = {};
    }

    get logger(): ILogger {
        return this._logger;
    }

    get sections(): ConfigSectionMeta[] {
        return _.values(this._sections);
    }

    get(name: string): ConfigSectionMeta {
        if (name in this._sections) {
            return this._sections[name];
        }
        throw new Error('Invalid section ' + name + ' provided.');
    }

    tryGet(name: string): ConfigSectionMeta | null {
        if (name in this._sections) {
            return this._sections[name];
        }
        return null;
    }

    section(name: string): ConfigSectionMeta {
        if (name in this._sections) {
            return this._sections[name];
        }
        const section = new ConfigSectionMeta(this, name);
        this._sections[name] = section;
        return section;
    }

    constructDn(metaName: string, naming: any): string {
        if (!_.isArray(naming)) {
            naming = [naming];
        }

        const newNaming: string[] = [];
        for (let x of naming) {
            if (typeof x !== 'undefined' && x !== null) {
                x = x.toString();
                if (x.indexOf('-') >= 0 || x.indexOf('[') >= 0 || x.indexOf(']') >= 0) {
                    x = '[' + x + ']';
                }
            } else {
                this._logger.error('Invalid naming: %s', metaName, naming);
                throw new Error('Invalid naming: ' + metaName);
            }
            newNaming.push(x);
        }

        const namingStr = newNaming.join('-');
        return metaName + '://' + namingStr;
    }

    breakDn(dn: string): DnInfo | null {
        const re = /^([\w-]+):\/\/(\S*)/;
        const matches = dn.match(re);
        if (!matches) {
            this._logger.error('Could not split dn: %s', dn);
            return null;
        }
        const metaName = matches[1];
        const namingStr = matches[2];

        const naming: string[] = [];
        let isWordStarted = false;
        let curr = '';
        let level = 0;
        let processedStr = '';
        for (const ch of namingStr) {
            processedStr = processedStr + ch;
            let realSymbol = true;
            let wordEnd = false;

            if (ch == '[') {
                if (level == 0) {
                    realSymbol = false;
                } else {
                    realSymbol = true;
                }
                level = level + 1;
            }

            if (ch == ']') {
                level = level - 1;
                if (level == 0) {
                    wordEnd = true;
                }
                if (level == 0) {
                    realSymbol = false;
                } else {
                    realSymbol = true;
                }
            }

            if (level < 0) {
                throw new Error('Invalid dn [1]: ' + dn + ', processed: ' + processedStr);
            }

            if (ch == '-') {
                if (level == 0) {
                    realSymbol = false;
                    wordEnd = true;
                }
            }

            if (realSymbol) {
                isWordStarted = true;
                curr = curr + ch;
            }

            if (wordEnd && isWordStarted) {
                naming.push(curr);
                curr = '';
                isWordStarted = false;
            }
        }

        if (isWordStarted) {
            if (level == 0) {
                naming.push(curr);
                curr = '';
            } else {
                throw new Error('Invalid dn [2]: ' + dn);
            }
        }

        return {
            metaName: metaName,
            meta: this.get(metaName),
            naming: naming,
        };
    }

    static load(normalizedPaths: string[], logger: ILogger, context: any): ConfigMeta {
        const configMeta = new ConfigMeta(logger);
        for (const normalizedPath of normalizedPaths) {
            fs.readdirSync(normalizedPath).forEach((file) => {
                const includePath = Path.join(normalizedPath, file);
                const metaName = _.replace(file, '.js', '');
                const metaSection = configMeta.section(metaName);
                const metaSectionInit = require(includePath);
                metaSectionInit(metaSection, logger, context);
                metaSection.done();
            });
        }
        return configMeta;
    }

    static validateNaming(naming: any): void {
        if (!_.isArray(naming)) {
            naming = [naming];
        }
        for (const x of naming) {
            if (_.isNullOrUndefined(x)) {
                throw new Error('Invalid naming: ' + JSON.stringify(naming));
            }
        }
    }
}
