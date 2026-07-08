import _ from 'the-lodash';

export type EnvDict = Record<string, string>;
export type EnvSet = Record<string, EnvDict>;

export function mergeEnvironment(baseEnv?: EnvDict | null, activeEnv?: EnvDict | null): EnvDict {
    let newEnv: EnvDict;
    if (!baseEnv) {
        newEnv = {};
    } else {
        newEnv = _.clone(baseEnv);
    }
    if (!activeEnv) {
        activeEnv = {};
    }
    for (const x of _.keys(activeEnv)) {
        newEnv[x] = activeEnv[x];
    }
    return newEnv;
}

export function resolveEnvironmentSet(environmentSet: EnvSet): EnvSet {
    const resolvedEnvSet: EnvSet = {};
    for (const envName of _.keys(environmentSet)) {
        const environment = environmentSet[envName];
        const mergedEnvironment = mergeEnvironment(environmentSet.global, environment);
        resolvedEnvSet[envName] = mergedEnvironment;
    }
    return resolvedEnvSet;
}

export function mergeEnvironmentSets(baseEnvSet: EnvSet, activeEnvSet: EnvSet): EnvSet {
    baseEnvSet = resolveEnvironmentSet(baseEnvSet);
    activeEnvSet = resolveEnvironmentSet(activeEnvSet);

    const resolvedEnvSet: EnvSet = {};
    for (const envName of _.union(_.keys(baseEnvSet), _.keys(activeEnvSet))) {
        let baseEnv: EnvDict;
        if (envName in baseEnvSet) {
            baseEnv = baseEnvSet[envName];
        } else {
            baseEnv = baseEnvSet.global;
        }
        let activeEnv: EnvDict;
        if (envName in activeEnvSet) {
            activeEnv = activeEnvSet[envName];
        } else {
            activeEnv = activeEnvSet.global;
        }
        const resolvedSet = mergeEnvironment(baseEnv, activeEnv);
        resolvedEnvSet[envName] = resolvedSet;
    }

    return resolvedEnvSet;
}

export function substituteEnvironment(envDict: EnvDict, substitutions: EnvDict): EnvDict {
    const result = _.clone(envDict);
    for (const key of _.keys(result)) {
        let val = result[key];
        // TODO: clean this crap up.
        for (const replacement of _.keys(substitutions)) {
            val = _.replace(val, '${' + replacement + '}', substitutions[replacement]);
        }
        for (const replacement of _.keys(envDict)) {
            val = _.replace(val, '${' + replacement + '}', envDict[replacement]);
        }
        result[key] = val;
    }
    return result;
}
