const toposort = require('toposort');
const _ = require('the-lodash');

class DependencyResolver
{
    constructor()
    {
        this._dependencyGraph = [];
        this._clients = {};
    }

    add(client, supplier)
    {
        this._clients[client] = client;
        if (supplier) {
            if (client !== supplier) {
                this._dependencyGraph.push([supplier, client]);
            }
        }
    }

    get order() {
        var buildOrder = toposort(this._dependencyGraph);
        var order = _.filter(buildOrder, x => (x in this._clients));
        var unusedClients = _.difference(_.keys(this._clients), order);
        return order.concat(unusedClients);
    }
}

module.exports = DependencyResolver;
