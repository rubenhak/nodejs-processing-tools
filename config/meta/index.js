const Promise = require('the-promise');
const _ = require('the-lodash');
const fs = require('fs');
const Path = require('path');

const ConfigSectionMeta = require('./section');

class ConfigMeta
{
    constructor(logger)
    {
        this._logger = logger;
        this._sections = {};
    }

    get logger() {
        return this._logger;
    }

    get sections() {
        return _.values(this._sections);
    }

    get(name)
    {
        if (name in this._sections) {
            return this._sections[name];
        }
        throw new Error('Invalid section ' + name + ' provided.');
        return null;
    }

    section(name)
    {
        if (name in this._sections) {
            return this._sections[name];
        }
        var section = new ConfigSectionMeta(this, name);
        this._sections[name] = section;
        return section;
    }

    constructDn(metaName, naming)
    {
        if (!_.isArray(naming)) {
            naming = [naming];
        }

        var newNaming = [];
        for (var x of naming) {
            if (typeof x !== 'undefined' && x !== null)
            {
                x = x.toString();
                if (x.indexOf('-') >= 0 || x.indexOf('[') >= 0 || x.indexOf(']') >= 0) {
                    x = '[' + x + ']';
                }
            }
            else
            {
                this._logger.error('Invalid naming: %s', metaName, naming );
                throw new Error('Invalid naming: ' + metaName);
                x = 'NULL';
            }
            newNaming.push(x);
        }

        var namingStr = newNaming.join('-');
        return metaName + '://' + namingStr;
    }

    breakDn(dn)
    {
        var re = /^([\w-]+):\/\/(\S*)/;
        var matches = dn.match(re);
        if (!matches) {
            this._logger.error('Could not split dn: %s', dn);
            return null;
        }
        var metaName = matches[1];
        var namingStr = matches[2];

        var naming = [];
        var isWordStarted = false;
        var curr = '';
        var level = 0;
        var processedStr = '';
        for (var ch of namingStr) {
            processedStr = processedStr + ch;
            var realSymbol = true;
            var wordEnd = false;

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
            naming: naming
        };
    }

    static load(normalizedPath, logger, context)
    {
        var configMeta = new ConfigMeta(logger);
        fs.readdirSync(normalizedPath).forEach((file) => {
            var includePath = Path.join(normalizedPath, file);
            var metaName = _.replace(file, '.js', '');
            var metaSection = configMeta.section(metaName);
            var metaSectionInit = require(includePath);
            metaSectionInit(metaSection, logger, context);
            metaSection.done();
        });
        return configMeta;
    }

    static validateNaming(naming)
    {
        if (!_.isArray(naming)) {
            naming = [naming];
        }
        for(var x of naming)
        {
            if (_.isNullOrUndefined(x)) {
                throw new Error('Invalid naming: ' + JSON.stringify(naming));
            }
        }
    }
}

module.exports = ConfigMeta;
