const Promise = require('the-promise');
const _ = require('lodash');
const fs = require('fs');
const Path = require('path');
const prettyMs = require('pretty-ms');

const ConfigMeta = require('./config/meta');
const Config = require('./config').Config;
const DeltaProcessor = require('./config').DeltaProcessor;

class ModelProcessor
{
    constructor(logger)
    {
        this._logger = logger;
        this._skipFileOutput = false;
        this._singleStageData = {};
        this._singleStageResult = null;
        this._stages = {};
        this._stageTimers = {};
        this._iterationNumber = 0;

        this._metaContext = {
            Promise: Promise,
            _: _,
            helper: this
        };

        this._iterationStages = {
            extractCurrent: 'extract-current',
            stabilizeCurrent: null,
            postExtractCurrent: null,
            createDesired: 'create-desired',
            constructDesired: null,
            finalizeDesired: null,
            processDelta: 'process-delta',
            decideNextSteps: 'decide-next-steps',
            postProcessDelta: null
        };

        this.setupStage('process-iteration', this._processIteration.bind(this));

        this.setupStage('extract-current', this._extractCurrent.bind(this));
        this.setupStage('create-desired', this._createDesired.bind(this));
        this.setupStage('process-delta', this._processDelta.bind(this));
        this.setupStage('decide-next-steps', this._decideNextSteps.bind(this));
        this.setupStage('autoconfig-desired', () => {
            return this._desiredConfig.performAutoConfig();
        });

        this.setupStage('output-current-config', () => {
            return this._outputCurrentConfig();
        });
        this.setupStage('output-desired-config', () => {
            return this._outputDesiredConfig();
        });
        this.setupStage('output-delta', () => {
            return this._outputDelta();
        });

        /********/
        this.setupStage('store-current-config-to-file', () => {
            return this._currentConfig.exportToFile('d:\\temp\\current-config-adjasensy.json');
        });

        this.setupStage('load-current-config-from-file', () => {
            return Promise.resolve()
                .then(() => {
                    this._currentConfig = new Config(this._configMeta);
                    return this._currentConfig.loadFromFile('d:\\temp\\current-config-adjasensy.json');
                })
        });
        /********/
    }

    _extractCurrent()
    {
        return this._extractConfig()
            .then(() => this._postCurrentConfigSetup());
    }

    _extractConfig(sectionFilter)
    {
        this._currentConfig = new Config(this._configMeta);
        return this._currentConfig.extract(this.clusterName, sectionFilter);
    }

    _createDesired()
    {
        if (!this._currentConfig) {
            this._desiredConfig = new Config(this._configMeta);
        } else {
            this._desiredConfig = new Config(this._configMeta, this._currentConfig);
        }
    }

    get singleStageData() {
        if (!this._singleStageData) {
            this._singleStageData = {};
        }
        return this._singleStageData;
    }

    setSingleStageData(name, value)
    {
        if (!this._singleStageData) {
            this._singleStageData = {};
        }
        this._singleStageData[name] = value;
        this._logger.info('[setSingleStageData] %s', name);
    }

    setSkipFileOutput(value) {
        this._skipFileOutput = value;
    }

    setLastDeltaConfig(value) {
        this._lastDeltaConfig = value;
    }

    setupStage(name, cb)
    {
        this._stages[name] = cb;
    }

    _setupConfigMeta()
    {
        var normalizedPath = Path.join(this._modelsDirLocation, "models");
        const modelLogger = this._logger.sublogger('Models');
        // modelLogger.level = 'info';
        this._configMeta = ConfigMeta.load(normalizedPath, modelLogger, this._metaContext);
    }

    runStage(name)
    {
        var stage = this._stages[name];
        if (!stage) {
            this._logger.info('Available stages: ', _.keys(this._stages));
            throw new Error('Unknown stage: ' + name);
        }
        this._logger.info('Running stage: %s...', name);
        this._stageTimers[name] = new Date();
        return Promise.resolve(stage())
            .then(result => {
                var timeDiff = new Date() - this._stageTimers[name];
                delete this._stageTimers[name];
                this._logger.info('Stage %s execution completed. Duration: %s.', name, prettyMs(timeDiff));
                return result;
            });
    }

    setup()
    {
        this._logger.info('Setup...');
        return Promise.resolve()
            .then(() => this._setupConfigMeta())
            .then(() => this._finalizeSetup());
    }

    newIteration()
    {
        this._singleStageResult = null;
        this._singleStageData = {};
        if (!this._iterationNumber) {
            this._iterationNumber = 1
        } else {
            this._iterationNumber++;
        }
    }

    postponeWithTimeout(timeoutSec, reason)
    {
        this._logger.info('Postponing next stage for %s seconds...', timeoutSec);

        this.singleStageResult.needMore = true;
        this.singleStageResult.needMoreReasons.push('PostponeWithTimeout. ' + reason);

        var postponeTill = new Date();
        postponeTill.setSeconds(postponeTill.getSeconds() + timeoutSec);
        postponeTill = postponeTill.toISOString();
        if (this.singleStageResult.postponeTill)
        {
            if (postponeTill > this.singleStageResult.postponeTill)
            {
                this.singleStageResult.postponeTill = postponeTill;
            }
        }
        else
        {
            this.singleStageResult.postponeTill = postponeTill;
        }

        this._logger.info('this.singleStageResult: ', this.singleStageResult);
    }

    _finalizeSetup()
    {
        /* TO BE IMPLEMENTED */
    }

    _extractCurrent()
    {
        return this._extractConfig();
    }

    _extractConfig(sectionFilter)
    {
        this._currentConfig = new Config(this._configMeta);
        return this._currentConfig.extract(this.clusterName, sectionFilter);
    }

    _setCurrentConfigStage(name)
    {
        this._currentConfigStage = name;
        return this.runStage('output-current-config');
    }

    _outputCurrentConfig()
    {
        this.setSingleStageData(this._currentConfigStage + 'CurrentConfig', this._currentConfig.exportToData());

        if (this._skipFileOutput) {
            return;
        }

        // this._logger.info('******** CURRENT CONFIG ********');
        //this._currentConfig.output();
        return this._currentConfig.debugOutputToFile('logs_berlioz/' + this._iterationNumber + '_' + this._currentConfigStage + '_current' + '.txt');
    }

    _setDesiredConfigStage(name)
    {
        this._desiredConfigStage = name;
        return this.runStage('output-desired-config');
    }

    _outputDesiredConfig()
    {
        this.setSingleStageData(this._desiredConfigStage + 'DesiredConfig', this._desiredConfig.exportToData());

        if (this._skipFileOutput) {
            return;
        }

        //this._logger.info('******** DESIRED CONFIG ********');
        //this._desiredConfig.output();
        return this._desiredConfig.debugOutputToFile('logs_berlioz/' + this._iterationNumber + '_' + this._desiredConfigStage + '_desired' + '.txt');
    }

    _processIteration()
    {
        this.newIteration();

        if (this._lastDeltaConfig) {
            this.setSingleStageData('lastDeltaConfig', this._lastDeltaConfig);
        }

        this.setSingleStageData('configStore', this.configStore._repo);

        return Promise.resolve()
            .then(() => this._runProcessorStage(this._iterationStages.extractCurrent))
            .then(() => this._setCurrentConfigStage('initial'))

            .then(() => this._runProcessorStage(this._iterationStages.stabilizeCurrent))
            .then(() => this._setCurrentConfigStage('stable'))

            .then(() => this._runProcessorStage(this._iterationStages.postExtractCurrent))
            .then(() => this._setCurrentConfigStage('complete'))

            .then(() => this._runProcessorStage(this._iterationStages.createDesired))
            .then(() => this._runProcessorStage(this._iterationStages.constructDesired))
            .then(() => this._runProcessorStage('autoconfig-desired'))
            .then(() => this._setDesiredConfigStage('initial'))

            .then(() => this._runProcessorStage(this._iterationStages.finalizeDesired))
            .then(() => this._runProcessorStage('autoconfig-desired'))
            .then(() => this._setDesiredConfigStage('complete'))

            .then(() => this._setDeltaStage('initial'))

            .then(() => this._runProcessorStage(this._iterationStages.processDelta))
            .then(() => this._setCurrentConfigStage('final'))
            .then(() => this._setDesiredConfigStage('final'))
            .then(() => this._setDeltaStage('final'))

            .then(() => this._runProcessorStage(this._iterationStages.decideNextSteps))

            .then(() => this._runProcessorStage(this._iterationStages.postProcessDelta))

            .then(() => {
                this._logger.info('singleStageResult: ', this.singleStageResult);
            })
            .then(() => this.singleStageResult);
    }

    _runProcessorStage(stage)
    {
        if (!stage) {
            return;
        }
        return this.runStage(stage);
    }

    _setDeltaStage(name)
    {
        this._deltaStage = name;
        return this.runStage('output-delta');
    }

    _outputDelta()
    {
        var deltaConfig = this._extractDelta();
        this.setSingleStageData(this._deltaStage + 'Delta', deltaConfig);

        this._logger.info('******** ' + this._deltaStage + ' DELTA ********');
        this._logger.info('%s', deltaConfig);
        this._debugOutputDeltaToFile(this._deltaStage, deltaConfig);
    }

    _processDelta()
    {
        this._setupNonConcurrentLabels(this._currentConfig);
        this._setupNonConcurrentLabels(this._desiredConfig);

        return Promise.resolve(true)
            .then(() => this._logger.info('Running AutoConfig...'))
            .then(() => this._desiredConfig.performAutoConfig())
            .then(() => {
                this._logger.info('Creating Delta Processor...');
                this.deltaProcessor = new DeltaProcessor(this._logger.sublogger('DeltaProcessor'), this._currentConfig, this._desiredConfig);
                this._logger.info('Delta KEYS: %s', '', _.keys(this.deltaProcessor.deltaConfig));
            })
            .then(() => {
                this._logger.info('Delta Processor ID=%s', this.deltaProcessor._id);
            })
            .then(() => {
                return this.deltaProcessor.process();
            })
            .then(result => {
                this._logger.info('Delta Processor Result: ', result);

                this.singleStageResult.processResult = result;
                this.singleStageResult.hasError = result.hasError;

                if (!result) {
                    this.markNewStageNeeded('ResultNotPresent');
                } else {
                    if (result.skippedTaskCount > 0) {
                        this.markNewStageNeeded('TasksSkipped');
                    }
                }
            })
            ;
    }

    _decideNextSteps()
    {
        var deltaConfig = this._singleStageData['finalDelta'];

        if (!this.singleStageResult.needMore)
        {
            if (deltaConfig.length > 0)
            {
                if (this._lastDeltaConfig)
                {
                    if (_.isEqual(this._lastDeltaConfig, deltaConfig))
                    {
                        this._logger.info('Final Delta is same as Last Final Delta. Thus not marking needMore.');
                    }
                    else
                    {
                        this._logger.info('Final Delta is different from Last Final Delta. Marking needMore.');
                        this.singleStageResult.needMore = true;
                        this.singleStageResult.needMoreReasons.push('FinalDeltaDifferentFromLastDelta');
                    }
                }
                else
                {
                    this._logger.info('No Last Filnal Delta present. Marking needMore.');
                    this.singleStageResult.needMore = true;
                    this.singleStageResult.needMoreReasons.push('NoLastDeltaPresent');
                }
            }
        }
    }

    get singleStageResult() {
        if (!this._singleStageResult) {
            this._singleStageResult = {
                skipFurtherStages: false,
                needMore: false,
                needMoreReasons: [],
                postponeTill: null
            };
        }
        return this._singleStageResult;
    }

    markNewStageNeeded(reason)
    {
        this._logger.info('Marking needs retry...');
        this.singleStageResult.needMore = true;
        this.singleStageResult.needMoreReasons.push('NewStageNeeded:' + reason);
    }

    _setupNonConcurrentLabels(config)
    {
        /* TO IMPLEMENT */
    }

    _extractDelta()
    {
        var deltaConfig = this._desiredConfig.produceDelta(this._currentConfig);
        // this._logger.info('******** COMPLETE DELTA ********');
        // this._logger.info('%s', '', deltaConfig);
        deltaConfig = _.values(deltaConfig).map(x => ({
            dn: x.dn,
            status: x.status,
            delta: x.delta
        }));
        return deltaConfig;
    }

    _debugOutputDeltaToFile(name, deltaConfig)
    {
        if (this._skipFileOutput) {
            return;
        }
        var writer = fs.createWriteStream('logs_berlioz/' + this._iterationNumber + '_' + name + '_delta.txt');
        for(var x of deltaConfig)
        {
            writer.write(x.dn + ' :: ' + x.status + '\n');
        }
        writer.end();
    }
}

module.exports = ModelProcessor;
