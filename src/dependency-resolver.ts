import _ from 'the-lodash';

const toposort = require('toposort');

export class DependencyResolver {
    private _dependencyGraph: [string, string][] = [];
    private _clients: Record<string, string> = {};

    add(client: string, supplier?: string): void {
        this._clients[client] = client;
        if (supplier) {
            if (client !== supplier) {
                this._dependencyGraph.push([supplier, client]);
            }
        }
    }

    get order(): string[] {
        const buildOrder: string[] = toposort(this._dependencyGraph);
        const order = _.filter(buildOrder, (x) => x in this._clients);
        const unusedClients = _.difference(_.keys(this._clients), order);
        return order.concat(unusedClients);
    }
}
