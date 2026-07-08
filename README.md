# Processing Tools

A TypeScript library of building blocks for **data-processing and reconciliation pipelines**: throttling, resource allocation, dependency-ordered task execution, hierarchical configuration stores, and a full model-driven "current vs. desired state" reconciliation engine.

```bash
npm install processing-tools
```

```ts
import { RateThrottler, DependencyProcessor, ConfigStore /* ... */ } from 'processing-tools';
```

All components are logger-agnostic. Almost every class takes an [`ILogger`](#logger-contract) as its first constructor argument — you supply the implementation, the library never picks one for you.

---

## Table of Contents

- [Throttlers](#throttlers) — cap concurrency or rate of async work
- [Allocators](#allocators) — hand out port blocks and CIDR subnets
- [Dependency Resolver](#dependency-resolver) — topological ordering
- [Dependency Processor](#dependency-processor) — run tasks respecting dependencies, labels, and readiness
- [Config Store](#config-store) — hierarchical key/value with inheritance
- [Repo Store](#repo-store) — named nested repositories with persistence and dirty-processing
- [Environment Tools](#environment-tools) — merge and substitute env dictionaries
- [Config Reconciliation Engine](#config-reconciliation-engine) — the model/delta/processor stack
- [Logger Contract](#logger-contract)

---

## Throttlers

Limit how async actions run. Each `execute()` call queues an action and returns a promise that resolves with the action's result once it is allowed to run and completes.

### `ConcurrentThrottler`

Caps the number of actions running **at the same time**.

```ts
import { ConcurrentThrottler } from 'processing-tools';

const throttler = new ConcurrentThrottler(logger, { number: 4 }); // at most 4 in flight

const results = await Promise.all(
    urls.map((url) => throttler.execute(() => fetch(url), `fetch:${url}`)),
);
```

### `RateThrottler`

Caps how many actions **start** within a sliding time window. Use it to respect rate limits (e.g. "no more than 10 requests per second").

```ts
import { RateThrottler } from 'processing-tools';

// at most 10 starts per 1000ms
const throttler = new RateThrottler(logger, { number: 10, interval: 1000 });

await throttler.execute(() => callApi(), 'api-call');
```

`interval` is in milliseconds. When the window is full the throttler schedules a timer and drains the queue as slots free up.

### `BaseThrottler`

The shared base class. Subclass it and implement `_canRun()` (and optionally `_onActionStart()` / `_processTaskChange()`) to build a custom admission policy. Exposes:

- `execute<T>(action: () => Promise<T> | T, name: string): Promise<T>`
- `hasWaitingActions: boolean`

---

## Allocators

### `PortAllocator`

Hands out fixed-size, non-overlapping **blocks of ports** from one or more free ranges. Allocations are sticky: asking again for the same `(service, sourcePort)` returns the same block.

```ts
import { PortAllocator } from 'processing-tools';

const allocator = new PortAllocator(logger, 100); // block size of 100 ports
allocator.addFreeRange(30000, 40000);

allocator.reserve('web', 443, 30500);           // pin a specific block
const block = allocator.allocate('web', 8080);   // -> { start, end } or null when exhausted
// block === { start: 30100, end: 30199 }  (example)

allocator.output(); // logs all current reservations
```

### `SubnetAllocator`

Carves **CIDR subnets** out of a larger range using a buddy-style split. Reserve subnets that are already in use, then allocate new ones by prefix length.

```ts
import { SubnetAllocator } from 'processing-tools';

const allocator = new SubnetAllocator('10.0.0.0/16');
allocator.reserve('10.0.1.0/24');          // mark as used

const cidr = allocator.allocate(24);        // -> '10.0.0.0/24' (or null if none fit)
```

`allocate(maskLength)` returns the smallest fitting free block, splitting larger free subnets as needed, or `null` when the range is exhausted.

---

## Dependency Resolver

Lightweight topological sort. Register `client → supplier` edges, read back a valid processing order. Self-edges are ignored and clients with no edges are still included.

```ts
import { DependencyResolver } from 'processing-tools';

const resolver = new DependencyResolver();
resolver.add('app', 'database'); // app depends on database
resolver.add('app', 'cache');
resolver.add('cache');           // no dependency

console.log(resolver.order); // suppliers first, e.g. ['database', 'cache', 'app']
```

---

## Dependency Processor

An asynchronous engine that runs a set of tasks while honouring **dependencies, concurrency labels, and readiness checks**. It is the workhorse behind the reconciliation engine, but is usable on its own.

You provide a `handler(id) => boolean | Promise<boolean>`. Returning `false` marks a task *unqualified* and skips everything that depends on it; throwing fails the run.

```ts
import { DependencyProcessor, TaskState } from 'processing-tools';

const processor = new DependencyProcessor(logger, 'my-run', async (id) => {
    await doWork(id);
    return true; // false => unqualified (dependents skipped)
});

processor.addTask('database');
processor.addTask('app');
processor.setDependency('app', 'database'); // app runs only after database completes

await processor.process(); // resolves when all done, rejects if any task failed
```

Capabilities:

| Method | Purpose |
| --- | --- |
| `addTask(id)` | Register a task (`id` is any JSON-serializable value). |
| `setDependency(id, predecessorId)` | `id` waits for `predecessorId` to reach `Complete`. |
| `setLabel(id, label)` | Tag a task (used for tracking / non-concurrency). |
| `setNonConcurrentLabels(id, labels)` | Prevent tasks sharing a label from running simultaneously. |
| `setPreRunChecker(id, () => boolean)` | Gate a task; `false` marks it unqualified before it starts. |
| `setCompletionChecker(id, cb)` | Poll for readiness after the handler resolves — return `{ ready }`, or `{ retry: true, timeout: <seconds> }` to re-check later. |
| `process()` | Run to completion. Resolves on success, rejects if any task failed. |
| `taskErrors` | Collected `TaskErrorInfo` for failed tasks. |
| `tasksByState` | Map of `TaskState` → tasks, for reporting. |
| `close()` | Stop processing and clear the internal health-check timer. |

Task lifecycle states (`TaskState`): `Idle`, `Running`, `WaitingFinish`, `Complete`, `Error`, `Unqualified`, `Skipped`.

---

## Config Store

A hierarchical key/value store with **inheritance along a path**. Values set at a shallow path act as defaults; values set deeper override them. `resolveValue` walks the path as far as it can and returns the deepest value found, falling back toward the root.

```ts
import { ConfigStore } from 'processing-tools';

const store = new ConfigStore(logger);
store.setValue([], 'timeout', 30);                    // global default
store.setValue(['prod'], 'timeout', 60);              // override for prod
store.setValue(['prod', 'db'], 'ssl', 'true');

store.resolveValue(['prod', 'db'], 'timeout');        // 60 (inherited from 'prod')
store.resolveValue(['staging'], 'timeout');           // 30 (global default)
store.resolveBoolValue(['prod', 'db'], 'ssl');        // true ('true'/'yes' => true)
```

---

## Repo Store

Manages several named **repositories** of nested dictionaries, with optional file persistence and a "dirty processing" workflow for reacting to changes.

```ts
import { RepoStore } from 'processing-tools';

const store = new RepoStore(logger, 'services');
store.setupPersistence('./state');

store.setupRepository('endpoints')
    .description('SERVICE ENDPOINTS')
    .handleDirty((service) => rebuildService(service), 1); // reprocess 1 level deep

store.set('endpoints', ['web', 'url'], 'https://example.com');
const url = store.get('endpoints', ['web', 'url']);   // read; null if missing
const node = store.at('endpoints', ['web']);          // read-or-create nested node

await store.persistStore(); // writes changed, persistable repos to ./state/*.json
```

Nested access: `at` (get-or-create), `get` (read, `null` if absent), `set`, `delete`, and `loop(name, keyPath, cb)` for serial iteration over a level.

Dirty processing lets you register a processor per repository and then:

- `markDirtyRepo(name, path)` — process immediately, or defer if the path is suppressed.
- `markRepoSuppressProcess(name, path, delay)` — suppress (`delay = true`) to batch changes, then release (`delay = false`) to flush everything that accumulated.
- `unmarkDirtyRepo(name, path)` — clear a pending dirty mark.

Repositories flagged `markDoNotPersist()` are kept in memory only; `persistStore()` writes the rest to `<dir>/<name>.json` and skips repos that haven't changed.

---

## Environment Tools

Helpers for composing environment-variable dictionaries (`EnvDict = Record<string, string>`) and sets of them keyed by name (`EnvSet`, where a `global` entry acts as the shared base).

```ts
import {
    mergeEnvironment,
    resolveEnvironmentSet,
    mergeEnvironmentSets,
    substituteEnvironment,
} from 'processing-tools';

// active overrides base
mergeEnvironment({ HOST: 'a', PORT: '80' }, { HOST: 'b' });
// => { HOST: 'b', PORT: '80' }

// fold the `global` env into every named env
resolveEnvironmentSet({
    global: { REGION: 'us' },
    prod: { TIER: 'high' },
});
// => { global: { REGION: 'us' }, prod: { REGION: 'us', TIER: 'high' } }

// layer one set over another (both resolved against their globals first)
mergeEnvironmentSets(baseSet, overrideSet);

// expand ${VAR} references
substituteEnvironment({ URL: '${HOST}:${PORT}' }, { HOST: 'db', PORT: '5432' });
// => { URL: 'db:5432' }
```

---

## Config Reconciliation Engine

The largest capability: a framework for driving real-world resources toward a desired state by computing and applying a **delta** between *current* and *desired* configurations. It is built from several cooperating pieces (all exported from the package root and from `processing-tools` config types).

### Concepts

- **`ConfigMeta` / `ConfigSectionMeta`** — the *schema*. A section describes one kind of resource and registers callbacks via a fluent API: how to list it (`onQueryAll`), how to read identity/config/runtime/relations off a raw object (`onExtractId`, `onExtractConfig`, `onExtractRuntime`, `onExtractRelations`), and how to change it (`onCreate`, `onUpdate`, `onDelete`, `onRelationCreate`, `onRelationDelete`). Additional hooks cover readiness (`onCheckReady`), auto-configuration (`onAutoConfig`), delta suppression (`onCheckIgnoreDelta`), and forced recreation (`onUpdateRecreate`). `ConfigMeta.load(paths, logger, context)` loads one metadata module per file from a directory.
- **`Config`** — a populated model: `ConfigSection`s holding `ConfigItem`s plus the `ConfigRelation`s between them. `extract()` builds the current model by querying every section; a *desired* `Config` is constructed against the current one for resolution. `produceDelta(base)` yields a `DeltaDict`.
- **`ConfigItem` / `ConfigRelation`** — a single resource (identified by a `dn` like `section://naming`) and a typed link to another item. Relations drive dependency ordering and can auto-create their targets.
- **`DeltaProcessor`** — takes current + desired `Config`, computes the delta, and applies it through a `DependencyProcessor`: creates items in relation order, deletes in reverse, updates in place, and recreates where required. Returns a `DeltaProcessResult` with per-task error and count breakdowns.
- **`ModelProcessor`** — orchestrates a full iteration: extract current → build desired → auto-config → compute and output delta → process delta → decide whether another iteration is needed. Extend it, wire section metadata and stage callbacks, and drive the pipeline via `runStage('process-iteration')`.

### Delta types

`produceDelta` classifies each item with a `DeltaItemStatus` — `Create`, `Update`, `Delete`, or `Recreate` — and details property-level (`ConfigPropertyDelta`) and relation-level (`RelationDelta`) changes, each carrying a `DeltaState` (`Create` / `Update` / `Delete`).

### Sketch

```ts
import { ConfigMeta, Config, DeltaProcessor } from 'processing-tools';

// 1. Load schema (one file per section under ./models)
const meta = ConfigMeta.load(['./models'], logger, context);

// 2. Extract the live/current state
const current = new Config(meta);
await current.extract();

// 3. Build the desired state against current
const desired = new Config(meta, current);
// ...populate desired sections/items/relations...
await desired.performAutoConfig();

// 4. Compute and apply the delta
const processor = new DeltaProcessor(logger, current, desired);
const result = await processor.process();
// result.failedTaskCount, result.skippedTaskCount, result.taskErrors, ...
```

For most uses you subclass `ModelProcessor`, which runs this loop for you and re-iterates until the model converges.

---

## Logger Contract

The library depends on an injected logger rather than shipping one. Provide an object implementing `ILogger`:

```ts
interface ILogger {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    crit(...args: any[]): void;
    verbose(...args: any[]): void;
    debug(...args: any[]): void;
    silly(...args: any[]): void;
    exception(error: any): void;
    sublogger(name: string): ILogger;          // scoped child logger
    outputFile(fileName: string, data: any): any;
    outputStream(fileName: string): IOutputWriter | null;
}
```

`sublogger` lets components create named child loggers; `outputFile` / `outputStream` (returning an `IOutputWriter` with `write` / `writeHeader` / `indent` / `unindent` / `close`) are used for debug dumps of configs and deltas.
