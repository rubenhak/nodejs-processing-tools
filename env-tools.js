const _ = require('lodash');

exports.mergeEnvironment = function(baseEnv, activeEnv)
{
    var newEnv = null;
    if (!baseEnv) {
        newEnv = {};
    } else {
        newEnv = _.clone(baseEnv);
    }
    if (!activeEnv) {
        activeEnv = {};
    }
    for (var x of _.keys(activeEnv)) {
        newEnv[x] = activeEnv[x];
    }
    return newEnv;
}

exports.resolveEnvironmentSet = function(environmentSet)
{
    var resolvedEnvSet = {};
    for (var envName of _.keys(environmentSet))
    {
        var environment = environmentSet[envName];
        var mergedEnvironment = exports.mergeEnvironment(environmentSet.global, environment);
        resolvedEnvSet[envName] = mergedEnvironment;
    }
    return resolvedEnvSet;
}

exports.mergeEnvironmentSets = function(baseEnvSet, activeEnvSet)
{
    baseEnvSet = exports.resolveEnvironmentSet(baseEnvSet);
    activeEnvSet = exports.resolveEnvironmentSet(activeEnvSet);

    var resolvedEnvSet = {};
    for (var envName of _.union(_.keys(baseEnvSet), _.keys(activeEnvSet)))
    {
        var baseEnv = null;
        if (envName in baseEnvSet) {
            baseEnv = baseEnvSet[envName];
        } else {
            baseEnv = baseEnvSet.global;
        }
        var activeEnv = null;
        if (envName in activeEnvSet) {
            activeEnv = activeEnvSet[envName];
        } else {
            activeEnv = activeEnvSet.global;
        }
        var resolvedSet = exports.mergeEnvironment(baseEnv, activeEnv);
        resolvedEnvSet[envName] = resolvedSet;
    }

    return resolvedEnvSet;
}

exports.extractEnvironment = function(obj, setName, substitutions)
{
    var result;
    if (obj.environment[setName]) {
        result = obj.environment[setName];
    }
    if (!result) {
        result = obj.environment.global;
    }
    if (!result) {
        result = {};
    }
    result = _.clone(result);
    for(var key of _.keys(result))
    {
        var val = result[key];
        for(var replacement of _.keys(substitutions))
        {
            val = _.replace(val, '${' + replacement +'}', substitutions[replacement]);
        }
        result[key] = val;
    }
    return result;

}
