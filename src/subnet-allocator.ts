import _ from 'the-lodash';

const ip = require('ip');

interface Subnet {
    networkAddress: string;
    broadcastAddress: string;
    subnetMaskLength: number;
    contains(address: string): boolean;
}

export class SubnetAllocator {
    private _rangeIp: Subnet;
    private _heapByMask: Record<number, Record<string, Subnet>> = {};
    private _heap: Record<string, Subnet> = {};

    constructor(rangeCidr: string) {
        this._rangeIp = ip.cidrSubnet(rangeCidr);

        this._addSubnet(this._rangeIp);
    }

    reserve(cidr: string): void {
        const subnet: Subnet = ip.cidrSubnet(cidr);
        for (const freeSubnet of _.values(this._heap)) {
            if (freeSubnet.contains(subnet.networkAddress)) {
                this._removeSubnet(freeSubnet);
                this._splitAndAdd(freeSubnet, subnet);
            }
        }
    }

    private _splitAndAdd(rootSubnet: Subnet, usedSubnet: Subnet): void {
        if (rootSubnet.subnetMaskLength > usedSubnet.subnetMaskLength) {
            return;
        }

        if (!rootSubnet.contains(usedSubnet.networkAddress)) {
            // console.log('[_splitAndAdd] ADD root=' + subnetToString(rootSubnet) + ' used=' + subnetToString(usedSubnet));
            this._addSubnet(rootSubnet);
            return;
        }

        if (rootSubnet.subnetMaskLength >= 32) {
            return;
        }

        const nextMaskBit = rootSubnet.subnetMaskLength + 1;

        const splitSubnet1: Subnet = ip.subnet(rootSubnet.networkAddress, ip.fromPrefixLen(nextMaskBit));

        let netAddrInt = ip.toLong(rootSubnet.networkAddress);
        netAddrInt += Math.pow(2, 32 - nextMaskBit);
        const splitSubnet2: Subnet = ip.subnet(ip.fromLong(netAddrInt), ip.fromPrefixLen(nextMaskBit));

        this._splitAndAdd(splitSubnet1, usedSubnet);
        this._splitAndAdd(splitSubnet2, usedSubnet);
    }

    allocate(maskLength: number): string | null {
        // console.log('[allocate] maskLength=' + maskLength);

        for (const key of _(this._heapByMask)
            .keys()
            .filter((x: any) => x <= maskLength)
            .sortBy()
            .reverse()
            .value()) {
            // console.log('[allocate] targetmaskSize=' + key);

            for (const freeSubnet of _.values(this._heapByMask[key as any])) {
                this._removeSubnet(freeSubnet);

                let curSubnet = freeSubnet;
                for (let i = freeSubnet.subnetMaskLength + 1; i <= maskLength; i++) {
                    // console.log("[allocate] ***********************************************")
                    const splitSubnet1: Subnet = ip.subnet(curSubnet.networkAddress, ip.fromPrefixLen(i));

                    let netAddrInt = ip.toLong(curSubnet.networkAddress);
                    netAddrInt += Math.pow(2, 32 - i);
                    const splitSubnet2: Subnet = ip.subnet(ip.fromLong(netAddrInt), ip.fromPrefixLen(i));
                    this._addSubnet(splitSubnet2);
                    curSubnet = splitSubnet1;
                }
                return '' + curSubnet.networkAddress + '/' + curSubnet.subnetMaskLength;
            }
        }
        return null;
    }

    private _addSubnet(subnet: Subnet): void {
        if (!(subnet.subnetMaskLength in this._heapByMask)) {
            this._heapByMask[subnet.subnetMaskLength] = {};
        }
        this._heapByMask[subnet.subnetMaskLength][subnet.networkAddress] = subnet;

        this._heap[subnet.networkAddress] = subnet;
    }

    private _removeSubnet(subnet: Subnet): void {
        delete this._heapByMask[subnet.subnetMaskLength][subnet.networkAddress];
        delete this._heap[subnet.networkAddress];
    }
}
