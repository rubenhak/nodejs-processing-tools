import { MyPromise } from 'the-promise';
import _ from 'the-lodash';
import * as Path from 'path';
import prettyMs from 'pretty-ms';

import { ConfigMeta } from './config/meta';
import { Config, DeltaProcessor } from './config';
import { DeltaItemStatus, ItemDelta } from './config/types';
import { ConfigStore } from './config-store';
import { ILogger, IOutputWriter } from './logger';

export interface StageError {
    target: string;
    action: string;
    message: string;
}

export interface SingleStageResult {
    hasError: boolean;
    isFailed: boolean;
    message: string | null;
    errors: StageError[];
    skipFurtherStages: boolean;
    skipStagesReasons: string[];
    needMore: boolean;
    needMoreReasons: string[];
    postponeTill: string | null;
    processResult?: any;
}

/**
 * Flattened per-item view of a delta, produced for stage data and debug output.
 */
export interface DeltaSummaryItem {
    dn: string;
    status: DeltaItemStatus;
    delta: ItemDelta | null | undefined;
    config: Record<string, any>;
}

export type StageCb = (...args: any[]) => any;

export class ModelProcessor {
    protected _logger: ILogger;
    private _singleStageData: Record<string, any>;
    private _singleStageResult: SingleStageResult | null;
    private _stages: Record<string, StageCb>;
    private _stageTimers: Record<string, Date>;
    private _iterationNumber: number;
    private _metaContext: Record<string, any>;
    private _configStore: ConfigStore;
    private _iterationStages: Record<string, any>;

    private _configMeta!: ConfigMeta;
    protected _currentConfig?: Config;
    protected _desiredConfig?: Config;
    private _currentConfigStage?: string;
    private _deltaStage?: string;
    private _lastDeltaConfig?: any;
    protected _modelsDirLocation?: string;
    protected _customModelsDirLocations?: string[];
    deltaProcessor?: DeltaProcessor;

    constructor(logger: ILogger) {
        this._logger = logger;
        this._singleStageData = {};
        this._singleStageResult = null;
        this._stages = {};
        this._stageTimers = {};
        this._iterationNumber = 0;

        this._metaContext = {
            Promise: MyPromise,
            _: _,
            helper: this,
        };

        this._configStore = new ConfigStore(this._logger.sublogger('ConfigStore'));

        this._iterationStages = {
            preSetup: null,
            iterationInit: null,
            extractCurrent: 'extract-current',
            stabilizeCurrent: null,
            postExtractCurrent: null,
            createDesired: 'create-desired',
            constructDesired: null,
            finalizeDesired: null,
            preProcessDelta: null,
            processDelta: 'process-delta',
            postProcessDelta: null,
            finish: null,
        };

        this.setupStage('process-iteration', this._processIteration.bind(this));
        this.setupStage('internal-preprocess-delta', this._internalPreProcessDelta.bind(this));

        this.setupStage('extract-current', this._extractCurrent.bind(this));
        this.setupStage('create-desired', this._createDesired.bind(this));
        this.setupStage('process-delta', this._processDelta.bind(this));
        this.setupStage('autoconfig-desired', () => {
            return this._desiredConfig!.performAutoConfig();
        });

        this.setupStage('output-current-config', () => {
            return this._outputCurrentConfig();
        });
        this.setupStage('output-desired-config', (desiredConfigStage: string) => {
            return this._outputDesiredConfig(desiredConfigStage);
        });
        this.setupStage('output-delta', () => {
            return this._outputDelta();
        });

        /********/
        this.setupStage('store-current-config-to-file', () => {
            return this._currentConfig!.exportToFile('d:\\temp\\current-config-adjasensy.json');
        });

        this.setupStage('load-current-config-from-file', () => {
            return Promise.resolve().then(() => {
                this._currentConfig = new Config(this._configMeta);
                return this._currentConfig.loadFromFile('d:\\temp\\current-config-adjasensy.json');
            });
        });
        /********/
    }

    get configStore(): ConfigStore {
        return this._configStore;
    }

    get singleStageData(): Record<string, any> {
        if (!this._singleStageData) {
            this._singleStageData = {};
        }
        return this._singleStageData;
    }

    private _extractCurrent(): Promise<any> {
        return this._extractConfig()
            .then(() => this._postCurrentConfigSetup())
            .catch((reason) => {
                this.singleStageResult.errors.push({
                    target: 'processor',
                    action: 'query-all',
                    message: reason.message,
                });
                throw reason;
            });
    }

    private _extractConfig(sectionFilter?: any): Promise<any> {
        this._currentConfig = new Config(this._configMeta);
        return this._currentConfig.extract(sectionFilter);
    }

    protected _postCurrentConfigSetup(): void {}

    private _createDesired(): void {
        if (!this._currentConfig) {
            this._desiredConfig = new Config(this._configMeta);
        } else {
            this._desiredConfig = new Config(this._configMeta, this._currentConfig);
        }
    }

    setSingleStageData(name: string, value: any): void {
        if (!this._singleStageData) {
            this._singleStageData = {};
        }
        this._singleStageData[name] = value;
        this._logger.info('[setSingleStageData] %s', name);
    }

    setLastDeltaConfig(value: any): void {
        this._lastDeltaConfig = value;
    }

    setupStage(name: string, cb: StageCb): void {
        this._stages[name] = cb;
    }

    private _setupConfigMeta(): void {
        const modelLogger = this._logger.sublogger('Models');
        let normalizedPaths: string[] = [];
        if (this._modelsDirLocation) {
            normalizedPaths.push(Path.join(this._modelsDirLocation, 'models'));
        }
        if (this._customModelsDirLocations) {
            normalizedPaths = _.concat(normalizedPaths, this._customModelsDirLocations);
        }
        this._configMeta = ConfigMeta.load(normalizedPaths, modelLogger, this._metaContext);
    }

    runStage(name: string, args?: any[]): Promise<any> {
        if (!args) {
            args = [];
        }
        const stage = this._stages[name];
        if (!stage) {
            this._logger.info('Available stages: ', _.keys(this._stages));
            throw new Error('Unknown stage: ' + name);
        }
        this._logger.info('Running stage: %s...', name);
        this._stageTimers[name] = new Date();
        return Promise.resolve(stage.apply(null, args)).then((result) => {
            const timeDiff = new Date().valueOf() - this._stageTimers[name].valueOf();
            delete this._stageTimers[name];
            this._logger.info('Stage %s execution completed. Duration: %s.', name, prettyMs(timeDiff));
            return result;
        });
    }

    private _setup(): Promise<any> {
        this._logger.info('Setup...');
        return Promise.resolve()
            .then(() => this._setupConfigMeta())
            .then(() => this._finalizeSetup());
    }

    addConfigEntries(configEntries: any[]): void {
        for (const x of configEntries) {
            this._addConfigEntry(x);
        }
        this.configStore.output();
    }

    protected _extractConfigEntryPath(entry: any): any[] {
        return null as any;
    }

    private _addConfigEntry(entry: any): void {
        let entryPath = this._extractConfigEntryPath(entry);
        entryPath = entryPath.filter((x) => _.isNotNullOrUndefined(x));
        this.configStore.setValue(entryPath, entry.property, entry.value);
    }

    newIteration(): void {
        this._singleStageResult = null;
        this._singleStageData = {};
        if (!this._iterationNumber) {
            this._iterationNumber = 1;
        } else {
            this._iterationNumber++;
        }
    }

    calculatePostponeDate(timeoutSec: number): string {
        const postponeTill = new Date();
        postponeTill.setSeconds(postponeTill.getSeconds() + timeoutSec);
        return postponeTill.toISOString();
    }

    postponeWithTimeoutAndSkip(timeoutSec: number, reason: string): void {
        this.postponeWithTimeout(timeoutSec, reason);
        this.skipFurtherStages(reason);
    }

    postponeWithTimeout(timeoutSec: number, reason: string): void {
        this._logger.info('Postponing next stage for %s seconds...', timeoutSec);

        this.markNewStageNeeded('PostponeWithTimeout. ' + reason);

        const postponeTill = this.calculatePostponeDate(timeoutSec);
        if (this.singleStageResult.postponeTill) {
            if (postponeTill > this.singleStageResult.postponeTill) {
                this.singleStageResult.postponeTill = postponeTill;
            }
        } else {
            this.singleStageResult.postponeTill = postponeTill;
        }

        this._logger.info('this.singleStageResult: ', this.singleStageResult);
    }

    protected _finalizeSetup(): void {
        /* TO BE IMPLEMENTED */
    }

    private _setCurrentConfigStage(name: string): Promise<any> {
        this._currentConfigStage = name;
        return this.runStage('output-current-config');
    }

    private _outputCurrentConfig(): any {
        if (!this._currentConfig) {
            return;
        }

        this.setSingleStageData(this._currentConfigStage + 'CurrentConfig', this._currentConfig.exportToData());

        return this._currentConfig.debugOutputToFile(
            this._iterationNumber + '_' + this._currentConfigStage + '_current' + '.txt',
        );
    }

    private _outputDesiredConfigStage(name: string): Promise<any> {
        return this.runStage('output-desired-config', [name]);
    }

    private _outputDesiredConfig(desiredConfigStage: string): any {
        if (!this._desiredConfig) {
            return;
        }

        this.setSingleStageData(desiredConfigStage + 'DesiredConfig', this._desiredConfig.exportToData());

        return this._desiredConfig.debugOutputToFile(
            this._iterationNumber + '_' + desiredConfigStage + '_desired' + '.txt',
        );
    }

    private _processIteration(): Promise<any> {
        return Promise.resolve()
            .then(() => this._runProcessorStage(this._iterationStages.preSetup))

            .then(() => this._setup())
            .then(() => {
                this.newIteration();

                if (this._lastDeltaConfig) {
                    this.setSingleStageData('lastDeltaConfig', this._lastDeltaConfig);
                }

                if (this.configStore) {
                    this.setSingleStageData('configStore', this.configStore.repo);
                }
            })
            .then(() => this._runProcessorStage(this._iterationStages.iterationInit))

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

            .catch((reason) => this._digestIterationError(reason, 'pre-final'))

            .then(() => this._decideNextSteps())

            .then(() => this._runProcessorStage(this._iterationStages.finish))
            .catch((reason) => this._digestIterationError(reason, 'pre-finish'))

            .then(() => {
                this._logger.info('singleStageResult: ', this.singleStageResult);
            })
            .then(() => this.singleStageResult);
    }

    private _digestIterationError(reason: any, checkpointName: string): void {
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

        this.singleStageResult.errors.push({
            target: 'processor',
            action: checkpointName,
            message: reason.message,
        });

        this.postponeWithTimeout(120, reason.message);
    }

    private _decideNextSteps(): void {
        if (this.singleStageResult.isFailed) {
            return;
        }

        if (!this.singleStageResult.needMore) {
            const deltaConfig = this._singleStageData['finalDelta'];
            if (!deltaConfig) {
                this.markNewStageNeeded('FinalDeltaMissing');
                return;
            }

            if (deltaConfig.length > 0) {
                if (this._lastDeltaConfig) {
                    if (_.isEqual(this._lastDeltaConfig, deltaConfig)) {
                        this._logger.info('Final Delta is same as Last Final Delta. Thus not marking needMore.');
                    } else {
                        this.markNewStageNeeded('FinalDeltaDifferentFromLastDelta');
                    }
                } else {
                    this.markNewStageNeeded('NoLastDeltaPresent');
                }
            }
        }
    }

    markConfigurationMissing(message: string): void {
        this.singleStageResult.skipFurtherStages = true;
        this.singleStageResult.skipStagesReasons.push(message);
        throw new MissingConfigurationError(message);
    }

    skipFurtherStages(message: string): void {
        this.singleStageResult.skipFurtherStages = true;
        this.singleStageResult.skipStagesReasons.push(message);
        throw new SkipFurtherStagesError(message);
    }

    private _runProcessorStage(stage: any, args?: any[]): any {
        if (!stage) {
            return;
        }
        if (_.isArray(stage)) {
            return MyPromise.serial(stage, (x) => this._runProcessorStage(x, args));
        }

        if (this.singleStageResult.skipFurtherStages) {
            this._logger.info('Skipping stage %s...', stage);
            return;
        }
        return this.runStage(stage, args);
    }

    private _internalPreProcessDelta(): any {
        if (!this._iterationStages.preProcessDelta) {
            return;
        }
        return MyPromise.serial(this._iterationStages.preProcessDelta, (stage: any) => {
            const deltaConfig = this._extractDelta();
            return Promise.resolve(this._runProcessorStage(stage, [deltaConfig])).then(() =>
                this._runProcessorStage('autoconfig-desired'),
            );
        }).then(() => this._setDeltaStage('complete'));
    }

    private _setDeltaStage(name: string): Promise<any> {
        this._deltaStage = name;
        return this.runStage('output-delta');
    }

    private _outputDelta(): any {
        const deltaConfig = this._extractDelta();
        this.setSingleStageData(this._deltaStage + 'Delta', deltaConfig);

        this._logger.info('******************************');
        this._logger.info('******** ' + this._deltaStage + ' DELTA ********');
        this._logger.info('******************************');
        for (const item of deltaConfig) {
            this._logger.info('Item %s, status: %s', item.dn, item.status);
            if (item.delta) {
                this._logger.info('        delta:', item.delta);
            }
            if (item.config) {
                this._logger.info('        config:', item.config);
            }
        }

        return this._debugOutputDeltaToFile(this._deltaStage!, deltaConfig);
    }

    private _processDelta(): Promise<any> {
        this._setupNonConcurrentLabels(this._currentConfig);
        this._setupNonConcurrentLabels(this._desiredConfig);

        return Promise.resolve(true)
            .then(() => this._logger.info('Running AutoConfig...'))
            .then(() => this._desiredConfig!.performAutoConfig())
            .then(() => {
                this._logger.info('Creating Delta Processor...');
                this.deltaProcessor = new DeltaProcessor(
                    this._logger.sublogger('DeltaProcessor'),
                    this._currentConfig!,
                    this._desiredConfig!,
                );
                this._logger.info('Delta KEYS: %s', '', _.keys(this.deltaProcessor.deltaConfig));
            })
            .then(() => {
                this._logger.info('Delta Processor ID=%s', this.deltaProcessor!.id);
            })
            .then(() => {
                return this.deltaProcessor!.process();
            })
            .then((result) => {
                this._logger.info('Delta Processor Result: ', result);

                this.singleStageResult.processResult = result;
                this.singleStageResult.hasError = result.hasError ?? false;

                if (result.taskErrors) {
                    for (const taskError of result.taskErrors) {
                        let target = 'unknown';
                        let action = 'unknown';
                        if (taskError.taskId) {
                            target = taskError.taskId.dn ?? 'unknown';
                            action = taskError.taskId.action;
                        }
                        this.singleStageResult.errors.push({
                            target: target,
                            action: action,
                            message: taskError.message ?? '',
                        });
                    }
                }

                if (!result) {
                    this.markNewStageNeeded('ResultNotPresent');
                } else {
                    if (result.skippedTaskCount > 0) {
                        this.markNewStageNeeded('TasksSkipped');
                    }
                }
            });
    }

    get singleStageResult(): SingleStageResult {
        if (!this._singleStageResult) {
            this._singleStageResult = {
                hasError: false,
                isFailed: false,
                message: null,
                errors: [],
                skipFurtherStages: false,
                skipStagesReasons: [],
                needMore: false,
                needMoreReasons: [],
                postponeTill: null,
            };
        }
        return this._singleStageResult;
    }

    markNewStageNeeded(reason: string): void {
        this._logger.info('Marking needMore: ', reason);
        this.singleStageResult.needMore = true;
        this.singleStageResult.needMoreReasons.push('NewStageNeeded:' + reason);
    }

    protected _setupNonConcurrentLabels(config: any): void {
        /* TO IMPLEMENT */
    }

    private _extractDelta(): DeltaSummaryItem[] {
        if (!this._desiredConfig || !this._currentConfig) {
            return [];
        }

        const deltaConfig = this._desiredConfig.produceDelta(this._currentConfig);
        this._logger.info('******** COMPLETE DELTA ********');

        const summary: DeltaSummaryItem[] = _.values(deltaConfig).map((x) => ({
            dn: x.dn,
            status: x.status,
            delta: x.delta,
            config: x.config,
        }));
        // this._logger.info('%s', '', summary);
        return summary;
    }

    debugWriteToFile(name: string, cb: (writer: IOutputWriter) => any): Promise<any> {
        const writer = this._logger.outputStream(this._iterationNumber + '_' + name + '.txt');
        if (!writer) {
            return Promise.resolve();
        }
        return Promise.resolve()
            .then(() => cb(writer))
            .then(() => writer.close());
    }

    private _debugOutputDeltaToFile(name: string, deltaConfig: DeltaSummaryItem[]): void {
        this._debugOutputDeltaHighLevelToFile(name, deltaConfig);
        this._debugOutputDeltaDetailedToFile(name, deltaConfig);
    }

    private _debugOutputDeltaHighLevelToFile(name: string, deltaConfig: DeltaSummaryItem[]): Promise<any> {
        return this.debugWriteToFile(name + '_delta', (writer) => {
            for (const x of deltaConfig) {
                writer.write(x.dn + ' :: ' + x.status);
            }
        });
    }

    private _debugOutputDeltaDetailedToFile(name: string, deltaConfig: DeltaSummaryItem[]): Promise<any> {
        return this.debugWriteToFile(name + '_delta_detailed', (writer) => {
            for (const x of deltaConfig) {
                writer.write(x.dn + ' :: ' + x.status);
                writer.write(JSON.stringify(x, null, 4));
            }
        });
    }
}

class SkipFurtherStagesError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

class MissingConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}
