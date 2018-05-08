var ip = require('ip');
var _ = require('the-lodash');

function subnetToString(subnet)
{
    return '[' + subnet.networkAddress + ' - ' + subnet.broadcastAddress + '] /' + subnet.subnetMaskLength ;
}

class SubnetAllocator
{
    constructor(rangeCidr)
    {
        this._rangeIp = ip.cidrSubnet(rangeCidr);
        this._heapByMask = {};
        this._heap = {};

        this._addSubnet(this._rangeIp);
    }

    reserve(cidr)
    {
        var subnet = ip.cidrSubnet(cidr);
        for(var freeSubnet of _.values(this._heap))
        {
            if (freeSubnet.contains(subnet.networkAddress))
            {
                this._removeSubnet(freeSubnet);
                this._splitAndAdd(freeSubnet, subnet);
            }
        }
    }

    _splitAndAdd(rootSubnet, usedSubnet)
    {
        if (rootSubnet.subnetMaskLength > usedSubnet.subnetMaskLength)
        {
            return;
        }

        if (!rootSubnet.contains(usedSubnet.networkAddress))
        {
            // console.log('[_splitAndAdd] ADD root=' + subnetToString(rootSubnet) + ' used=' + subnetToString(usedSubnet));
            this._addSubnet(rootSubnet);
            return;
        }

        if (rootSubnet.subnetMaskLength >= 32)
        {
            return;
        }

        var nextMaskBit = rootSubnet.subnetMaskLength + 1;

        var splitSubnet1 = ip.subnet(rootSubnet.networkAddress, ip.fromPrefixLen(nextMaskBit));

        var netAddrInt = ip.toLong(rootSubnet.networkAddress);
        netAddrInt += Math.pow(2, (32 - nextMaskBit));
        var splitSubnet2 = ip.subnet(ip.fromLong(netAddrInt), ip.fromPrefixLen(nextMaskBit));

        this._splitAndAdd(splitSubnet1, usedSubnet);
        this._splitAndAdd(splitSubnet2, usedSubnet);
    }

    allocate(maskLength)
    {
        // console.log('[allocate] maskLength=' + maskLength);

        for(var key of _(this._heapByMask).keys().filter(x => x <= maskLength).sortBy().reverse().value())
        {
            // console.log('[allocate] targetmaskSize=' + key);

            for(var freeSubnet of _.values(this._heapByMask[key]))
            {
                this._removeSubnet(freeSubnet);

                var i;
                var curSubnet = freeSubnet;
                for(i = freeSubnet.subnetMaskLength + 1; i <= maskLength; i++)
                {
                    // console.log("[allocate] ***********************************************")
                    var splitSubnet1 = ip.subnet(curSubnet.networkAddress, ip.fromPrefixLen(i));

                    var netAddrInt = ip.toLong(curSubnet.networkAddress);
                    netAddrInt += Math.pow(2, (32 - i));
                    var splitSubnet2 = ip.subnet(ip.fromLong(netAddrInt), ip.fromPrefixLen(i));
                    this._addSubnet(splitSubnet2);
                    curSubnet = splitSubnet1;
                }
                return '' + curSubnet.networkAddress + '/' + curSubnet.subnetMaskLength;
            }
        }
        return null;
    }

    _addSubnet(subnet)
    {
        if (!(subnet.subnetMaskLength in this._heapByMask))
        {
            this._heapByMask[subnet.subnetMaskLength] = {};
        }
        this._heapByMask[subnet.subnetMaskLength][subnet.networkAddress] = subnet;

        this._heap[subnet.networkAddress] = subnet;
    }

    _removeSubnet(subnet)
    {
        delete this._heapByMask[subnet.subnetMaskLength][subnet.networkAddress];
        delete this._heap[subnet.networkAddress];
    }

}

module.exports = SubnetAllocator;
