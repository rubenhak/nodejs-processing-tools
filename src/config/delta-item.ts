import { ILogger } from '../logger';
import { DeltaItemStatus, ItemDelta } from './types';
import type { ConfigItem } from './item';
import type { Config } from './config';
import type { ConfigSectionMeta } from './meta/section';

export type DeltaDict = Record<string, ConfigDeltaItem>;

export class ConfigDeltaItem {
    private _item: ConfigItem;
    private _logger: ILogger;
    private _status: DeltaItemStatus;
    private _delta: ItemDelta | null | undefined;

    constructor(item: ConfigItem, status: DeltaItemStatus, delta?: ItemDelta | null) {
        this._item = item;
        this._logger = item.logger;
        this._status = status;
        this._delta = delta;
    }

    get meta(): ConfigSectionMeta {
        return this.item.meta;
    }

    get dn(): string {
        return this.item.dn;
    }

    get naming(): any {
        return this.item.naming;
    }

    get id(): any {
        const baseItem = this.baseItem;
        if (baseItem) {
            return baseItem.id;
        }
        return null;
    }

    get item(): ConfigItem {
        return this._item;
    }

    get status(): DeltaItemStatus {
        return this._status;
    }

    get baseItem(): ConfigItem | null {
        return this.item.root.resolveDn(this.dn);
    }

    get resolutionConfig(): Config {
        if (this.item.root.resolutionConfig) {
            return this.item.root.resolutionConfig;
        }
        return this.item.root;
    }

    get obj(): any {
        const baseItem = this.baseItem;
        if (baseItem) {
            return baseItem.obj;
        }
        return null;
    }

    get delta(): ItemDelta | null | undefined {
        return this._delta;
    }

    get config(): Record<string, any> {
        return this.item.config;
    }

    get runtime(): any {
        return this.item.runtime;
    }

    findRelation(targetSectionName: string): any {
        return this.item.findRelation(targetSectionName);
    }

    findRelations(targetSectionName: string): any {
        return this.item.findRelations(targetSectionName);
    }

    output(): void {
        this._logger.info('DeltaItem %s to %s.', this.dn, this.status);
        if (this.baseItem) {
            this._logger.info('    HasBaseItem. id=%s.', this.id);
        }
        if (this.obj) {
            this._logger.info('    HasObjObject.');
        }
    }
}
