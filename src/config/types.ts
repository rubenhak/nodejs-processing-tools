/**
 * Status assigned to a config item inside a delta dictionary.
 */
export enum DeltaItemStatus {
    Create = 'create',
    Update = 'update',
    Delete = 'delete',
    Recreate = 'recreate',
}

/**
 * State of an individual config property or relation change within an item delta.
 */
export enum DeltaState {
    Create = 'create',
    Update = 'update',
    Delete = 'delete',
}

/**
 * Action performed by the delta processor for a given config item.
 */
export enum TaskAction {
    Create = 'create',
    Delete = 'delete',
    Breaker = 'breaker',
}

/**
 * Identifier of a task scheduled on the dependency processor by the delta processor.
 */
export interface DeltaTaskId {
    dn?: string;
    action: TaskAction;
}

/**
 * Change of a single config property between the base and target items.
 */
export interface ConfigPropertyDelta {
    oldValue?: any;
    value?: any;
    state: DeltaState;
}

/**
 * Change of a single relation between the base and target items.
 */
export interface RelationDelta {
    targetMeta: string;
    relation: string;
    currentId?: any;
    resolvedTargetId?: any;
    runtime?: any;
    state: DeltaState;
}

/**
 * Aggregated configuration and relation changes produced for one item.
 */
export interface ItemDelta {
    configs: Record<string, ConfigPropertyDelta>;
    relations: RelationDelta[];
}
