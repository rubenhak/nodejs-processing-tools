const Promise = require('the-promise');
const _ = require('the-lodash');
const Path = require('path');
const prettyMs = require('pretty-ms');

const ConfigMeta = require('./config/meta');
const Config = require('./config').Config;
const DeltaProcessor = require('./config').DeltaProcessor;
const ConfigStore = require('./config-store');

class ModelProcessor
{
    constructor(logger)
    {
        this._logger = logger;
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

        this._configStore = new ConfigStore(this._logger.sublogger('ConfigStore'));

        this._iterationStages = {
            preSetup: null,
            interationInit: null,
            extractCurrent: 'extract-current',
            stabilizeCurrent: null,
            postExtractCurrent: null,
            createDesired: 'create-desired',
            constructDesired: null,
            finalizeDesired: null,
            preProcessDelta: null,
            processDelta: 'process-delta',
            postProcessDelta: null,
            finish: null
        };

        this.setupStage('process-iteration', this._processIteration.bind(this));
        this.setupStage('internal-preprocess-delta', this._internalPreProcessDelta.bind(this));

        this.setupStage('extract-current', this._extractCurrent.bind(this));
        this.setupStage('create-desired', this._createDesired.bind(this));
        this.setupStage('process-delta', this._processDelta.bind(this));
        this.setupStage('autoconfig-desired', () => {
            return this._desiredConfig.performAutoConfig();
        });

        this.setupStage('output-current-config', () => {
            return this._outputCurrentConfig();
        });
        this.setupStage('output-desired-config', (desiredConfigStage) => {
            return this._outputDesiredConfig(desiredConfigStage);
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

    get configStore() {
        return this._configStore;
    }

    get singleStageData() {
        if (!this._singleStageData) {
            this._singleStageData = {};
        }
        return this._singleStageData;
    }

    _extractCurrent()
    {
        return this._extractConfig()
            .then(() => this._postCurrentConfigSetup());
    }

    _extractConfig(sectionFilter)
    {
        this._currentConfig = new Config(this._configMeta);
        return this._currentConfig.extract(sectionFilter);
    }

    _postCurrentConfigSetup()
    {

    }

    _createDesired()
    {
        if (!this._currentConfig) {
            this._desiredConfig = new Config(this._configMeta);
        } else {
            this._desiredConfig = new Config(this._configMeta, this._currentConfig);
        }
    }

    setSingleStageData(name, value)
    {
        if (!this._singleStageData) {
            this._singleStageData = {};
        }
        this._singleStageData[name] = value;
        this._logger.info('[setSingleStageData] %s', name);
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
        const modelLogger = this._logger.sublogger('Models');
        var normalizedPaths = [];
        if (this._modelsDirLocation) {
            normalizedPaths.push(Path.join(this._modelsDirLocation, "models"));
        }
        if (this._customModelsDirLocations) {
            normalizedPaths = _.concat(normalizedPaths, this._customModelsDirLocations)
        }
        this._configMeta = ConfigMeta.load(normalizedPaths, modelLogger, this._metaContext);
    }

    runStage(name, args)
    {
        if (!args) {
            args = []
        }
        var stage = this._stages[name];
        if (!stage) {
            this._logger.info('Available stages: ', _.keys(this._stages));
            throw new Error('Unknown stage: ' + name);
        }
        this._logger.info('Running stage: %s...', name);
        this._stageTimers[name] = new Date();
        return Promise.resolve(stage.apply(null, args))
            .then(result => {
                var timeDiff = new Date() - this._stageTimers[name];
                delete this._stageTimers[name];
                this._logger.info('Stage %s execution completed. Duration: %s.', name, prettyMs(timeDiff));
                return result;
            });
    }

    _setup()
    {
        this._logger.info('Setup...');
        return Promise.resolve()
            .then(() => this._setupConfigMeta())
            .then(() => this._finalizeSetup());
    }

    addConfigEntries(configEntries)
    {
        for(var x of configEntries)
        {
            this._addConfigEntry(x);
        }
        this.configStore.output();
    }

    _extractConfigEntryPath(entry) {
        return null;
    }

    _addConfigEntry(entry)
    {
        var entryPath = this._extractConfigEntryPath(entry);
        entryPath = entryPath.filter(x => _.isNotNullOrUndefined(x));
        this.configStore.setValue(entryPath, entry.property, entry.value);
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

        this.markNewStageNeeded('PostponeWithTimeout. ' + reason);

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

    _setCurrentConfigStage(name)
    {
        this._currentConfigStage = name;
        return this.runStage('output-current-config');
    }

    _outputCurrentConfig()
    {
        if (!this._currentConfig) {
            return;
        }

        this.setSingleStageData(this._currentConfigStage + 'CurrentConfig', this._currentConfig.exportToData());

        return this._currentConfig.debugOutputToFile(this._iterationNumber + '_' + this._currentConfigStage + '_current' + '.txt');
    }

    _outputDesiredConfigStage(name)
    {
        return this.runStage('output-desired-config', [name]);
    }

    _outputDesiredConfig(desiredConfigStage)
    {
        if (!this._desiredConfig) {
            return;
        }

        this.setSingleStageData(desiredConfigStage + 'DesiredConfig', this._desiredConfig.exportToData());

        return this._desiredConfig.debugOutputToFile(this._iterationNumber + '_' + desiredConfigStage + '_desired' + '.txt');
    }

    _processIteration()
    {
        return Promise.resolve()
            .then(() => this._runProcessorStage(this._iterationStages.preSetup))

            .then(() => this._setup())
            .then(() => {
                this.newIteration();

                if (this._lastDeltaConfig) {
                    this.setSingleStageData('lastDeltaConfig', this._lastDeltaConfig);
                }
        
                if (this.configStore) {
                    this.setSingleStageData('configStore', this.configStore._repo);
                }
            })
            .then(() => this._runProcessorStage(this._iterationStages.interationInit))

            .then(() => this._runProcessorStage(this._iterationStages.extractCurrent))
            .then(() => this._setCurrentConfigStage('initial'))

            .then(() => this._runProcessorStage(this._iterationStages.stabilizeCurrent))
            .then(() => this._setCurrentConfigStage('stable'))

            .then(() => this._runProcessorStage(this._iterationStages.postExtractCurrent))
            .then(() => this._setCurrentConfigStage('complete'))

            .then(() => this._runProcessorStage(this._iterationStages.createDesired))
            .then(() => this._runProcessorStage(this._iterationStages.constructDesired))
            .then(() => this._runProcessorStage('autoconfig-desired'))
            .then(() => this._outputDesiredConfigStage('initial'))

            .then(() => this._runProcessorStage(this._iterationStages.finalizeDesired))
            .then(() => this._runProcessorStage('autoconfig-desired'))

            .then(() => this._setDeltaStage('initial'))

            .then(() => this._runProcessorStage('internal-preprocess-delta'))

            .then(() => this._outputDesiredConfigStage('complete'))

            .then(() => this._runProcessorStage(this._iterationStages.processDelta))

            .then(() => this._runProcessorStage(this._iterationStages.postProcessDelta))

            .then(() => this._setCurrentConfigStage('final'))
            .then(() => this._outputDesiredConfigStage('final'))
            .then(() => this._setDeltaStage('final'))

            .catch(reason => this._digestIterationError(reason))

            .then(() => this._decideNextSteps())

            .then(() => this._runProcessorStage(this._iterationStages.finish))
            .catch(reason => this._digestIterationError(reason))

            .then(() => {
                this._logger.info('singleStageResult: ', this.singleStageResult);
            })
            .then(() => this.singleStageResult);
    }

    _digestIterationError(reason)
    {
        // TODO
        this._logger.warn('[_digestIterationError] ', reason);

        if (reason instanceof SkipFurtherStagesError) {
            return;
        }

        if (reason instanceof MissingConfigurationError) {
            this.singleStageResult.isFailed = true;
            this.singleStageResult.message = reason.message;
            return;
        }

        this._logger.error('ERROR during processing: ', reason);
        this.singleStageResult.hasError = true;
        this.singleStageResult.message = reason.message;
        this.postponeWithTimeout(120, reason.message);
    }
    
    _decideNextSteps()
    {
        if (this.singleStageResult.isFailed) {
            return;
        }

        if (!this.singleStageResult.needMore)
        {
            var deltaConfig = this._singleStageData['finalDelta'];
            if (!deltaConfig) {
                this.markNewStageNeeded('FinalDeltaMissing');
                return;
            }

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
                        this.markNewStageNeeded('FinalDeltaDifferentFromLastDelta');
                    }
                }
                else
                {
                    this.markNewStageNeeded('NoLastDeltaPresent');
                }
            }
        }
    }

    markConfigurationMissing(message)
    {
        this.singleStageResult.skipFurtherStages = true;
        this.singleStageResult.skipStagesReasons.push(message);
        throw new MissingConfigurationError(message);
    }

    skipFurtherStages(message)
    {
        this.singleStageResult.skipFurtherStages = true;
        this.singleStageResult.skipStagesReasons.push(message);
        throw new SkipFurtherStagesError(message);
    }

    _runProcessorStage(stage, args)
    {
        if (!stage) {
            return;
        }
        if (_.isArray(stage)) {
            return Promise.serial(stage, x => this._runProcessorStage(x, args));
        }

        if (this.singleStageResult.skipFurtherStages) {
            this._logger.info('Skipping stage %s...', stage);
            return;
        }
        return this.runStage(stage, args);
    }

    _internalPreProcessDelta()
    {
        if (!this._iterationStages.preProcessDelta) {
            return;
        }
        return Promise.serial(this._iterationStages.preProcessDelta, stage => {
            var deltaConfig = this._extractDelta();
            return Promise.resolve(this._runProcessorStage(stage, [deltaConfig]))
                .then(() => this._runProcessorStage('autoconfig-desired'))
        })
        .then(() => this._setDeltaStage("complete"));
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

        this._logger.info('******************************');
        this._logger.info('******** ' + this._deltaStage + ' DELTA ********');
        this._logger.info('******************************');
        for(var item of deltaConfig)
        {
            this._logger.info('Item %s, status: %s', item.dn, item.status);
            if (item.delta) {
                this._logger.info('        delta:', item.delta);
            }
            if (item.config) {
                this._logger.info('        config:', item.config);
            }
        }

        return this._debugOutputDeltaToFile(this._deltaStage, deltaConfig);
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


    get singleStageResult() {
        if (!this._singleStageResult) {
            this._singleStageResult = {
                hasError: false,
                isFailed: false, 
                message: null,
                skipFurtherStages: false,
                skipStagesReasons: [],
                needMore: false,
                needMoreReasons: [],
                postponeTill: null
            };
        }
        return this._singleStageResult;
    }

    markNewStageNeeded(reason)
    {
        this._logger.info('Marking needMore: ', reason);
        this.singleStageResult.needMore = true;
        this.singleStageResult.needMoreReasons.push('NewStageNeeded:' + reason);
    }

    _setupNonConcurrentLabels(config)
    {
        /* TO IMPLEMENT */
    }

    _extractDelta()
    {
        if (!this._desiredConfig || !this._currentConfig) {
            return [];
        }

        var deltaConfig = this._desiredConfig.produceDelta(this._currentConfig);
        this._logger.info('******** COMPLETE DELTA ********');

        deltaConfig = _.values(deltaConfig).map(x => ({
            dn: x.dn,
            status: x.status,
            delta: x.delta,
            config: x.config
        }));
        // this._logger.info('%s', '', deltaConfig);
        return deltaConfig;
    }


    _debugOutputDeltaToFile(name, deltaConfig)
    {
        this._debugOutputDeltaHighLevelToFile(name, deltaConfig);
        this._debugOutputDeltaDetailedToFile(name, deltaConfig);
    }

    _debugOutputDeltaHighLevelToFile(name, deltaConfig)
    {
        var writer = this._logger.outputStream(this._iterationNumber + '_' + name + '_delta.txt');
        if (!writer) {
            return;
        }
        for(var x of deltaConfig)
        {
            writer.write(x.dn + ' :: ' + x.status);
        }
        return writer.close();
    }

    _debugOutputDeltaDetailedToFile(name, deltaConfig)
    {
        var writer = this._logger.outputStream(this._iterationNumber + '_' + name + '_delta_detailed.txt');
        if (!writer) {
            return;
        }
        for(var x of deltaConfig)
        {
            writer.write(x.dn + ' :: ' + x.status);
            writer.write(JSON.stringify(x, null, 4));
        }
        return writer.close();
    }
}

class SkipFurtherStagesError extends Error
{
    constructor(message)
    {
      super(message);
      this.name = this.constructor.name;
      Error.captureStackTrace(this, this.constructor);
    }
}

class MissingConfigurationError extends Error
{
    constructor(message)
    {
      super(message);
      this.name = this.constructor.name;
      Error.captureStackTrace(this, this.constructor);
    }
}



module.exports = ModelProcessor;
