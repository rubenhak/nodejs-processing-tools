import _ from 'the-lodash';

import { ILogger } from './logger';

export interface PortBlockInfo {
    start: number;
    end: number;
}

export class PortAllocator {
    private _logger: ILogger;
    private _blockSize: number;
    private _freeBlock: Record<string, boolean> = {};
    private _reservations: Record<string, Record<string, number>> = {};

    constructor(logger: ILogger, blockSize: number) {
        this._logger = logger;
        this._blockSize = blockSize;
    }

    addFreeRange(start: number, end: number): void {
        this._logger.info('Adding free range: [%s, %s]', start, end);

        const blockStart = this._toBlock(start) + 1;
        const blockEnd = this._toBlock(end) - 1;
        for (let block = blockStart; block < blockEnd; block++) {
            this._addFreeBlock(block);
        }
    }

    allocate(service: string, sourcePort: number | string): PortBlockInfo | null {
        this._logger.info('Allocating %s :: %s', service, sourcePort);
        let block: number | null = null;
        if (service in this._reservations) {
            if (sourcePort in this._reservations[service]) {
                block = this._reservations[service][sourcePort];
            }
        }

        if (!block) {
            const freeKey = _.findKey(this._freeBlock, () => true);
            if (freeKey) {
                block = parseInt(freeKey);
                this._reserveBlock(service, sourcePort, block);
            }
        }

        if (block) {
            return this._getBlockInfo(block);
        } else {
            return null;
        }
    }

    reserve(service: string, sourcePort: number | string, port: number): void {
        this._logger.info('Reserving %s :: %s -> %s', service, sourcePort, port);

        const block = this._toBlock(port);
        if (this._freeBlock[block]) {
            this._reserveBlock(service, sourcePort, block);
        }
    }

    private _reserveBlock(service: string, sourcePort: number | string, block: number): void {
        delete this._freeBlock[block];
        if (!(service in this._reservations)) {
            this._reservations[service] = {};
        }
        this._reservations[service][sourcePort] = block;
    }

    private _addFreeBlock(block: number): void {
        this._freeBlock[block] = true;
    }

    private _toBlock(port: number): number {
        return _.floor(parseInt(port.toString()) / this._blockSize);
    }

    private _toPort(block: number): number {
        return block * this._blockSize;
    }

    private _getBlockInfo(block: number): PortBlockInfo {
        const startPort = this._toPort(block);
        const endPort = this._toPort(block + 1) - 1;
        return {
            start: startPort,
            end: endPort,
        };
    }

    output(): void {
        this._logger.info('Reservations BEGIN');
        for (const service of _.keys(this._reservations)) {
            for (const sourcePort of _.keys(this._reservations[service])) {
                const block = this._reservations[service][sourcePort];
                const blockInfo = this._getBlockInfo(block);
                this._logger.info('* %s :: %s -> [%s, %s]', service, sourcePort, blockInfo.start, blockInfo.end);
            }
        }
        this._logger.info('Reservations END');
    }
}
