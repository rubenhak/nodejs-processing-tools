var _ = require('the-lodash');

class PortAllocator
{
    constructor(logger, blockSize)
    {
        this._logger = logger;
        this._blockSize = blockSize;
        this._freeBlock = {};
        this._reservations = {};
    }

    addFreeRange(start, end)
    {
        this._logger.info('Adding free range: [%s, %s]', start, end);

        var blockStart = this._toBlock(start) + 1;
        var blockEnd = this._toBlock(end) - 1;
        for (var block = blockStart; block < blockEnd; block++)
        {
            this._addFreeBlock(block);
        }
    }

    allocate(service, sourcePort)
    {
        this._logger.info('Allocating %s :: %s', service, sourcePort);
        var block = null;
        if (service in this._reservations) {
            if (sourcePort in this._reservations[service]) {
                block = this._reservations[service][sourcePort];
            }
        }

        if (!block) {
            var block = _.findKey(this._freeBlock, x => true);
            if (block) {
                this._reserveBlock(service, sourcePort, block);
            }
        }

        if (block) {
            return this._getBlockInfo(block);
        } else {
            return null;
        }
    }

    reserve(service, sourcePort, port)
    {
        this._logger.info('Reserving %s :: %s -> %s', service, sourcePort, port);

        var block = this._toBlock(port);
        if (this._freeBlock[block]) {
            this._reserveBlock(service, sourcePort, block);
        }
    }

    _reserveBlock(service, sourcePort, block)
    {
        delete this._freeBlock[block];
        if (!(service in this._reservations)) {
            this._reservations[service] = {};
        }
        this._reservations[service][sourcePort] = block;
    }

    _addFreeBlock(block)
    {
        this._freeBlock[block] = true;
    }

    _toBlock(port)
    {
        return _.floor(parseInt(port) / this._blockSize);
    }

    _toPort(block)
    {
        return parseInt(block) * this._blockSize;
    }

    _getBlockInfo(block)
    {
        block = parseInt(block);
        var startPort = this._toPort(block);
        var endPort = this._toPort(block + 1) - 1;
        return {
            start: startPort,
            end: endPort
        };
    }

    output()
    {
        this._logger.info('Reservations BEGIN');
        for(var service of _.keys(this._reservations))
        {
            for(var sourcePort of _.keys(this._reservations[service]))
            {
                var block = this._reservations[service][sourcePort];
                var blockInfo = this._getBlockInfo(block);
                this._logger.info('* %s :: %s -> [%s, %s]', service, sourcePort, blockInfo.start, blockInfo.end);
            }
        }
        this._logger.info('Reservations END');
    }
}

module.exports = PortAllocator;
