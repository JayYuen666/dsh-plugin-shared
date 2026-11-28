<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/JayYuen666/dsh-plugin-shared@main/icon.svg" width="96" height="96" alt="dsh-plugin-shared logo" />
</p>

<h1 align="center">dsh-plugin-shared</h1>

<p align="center"><em>The shared library behind the dsh plugin family: a tool-event record table, card state helpers, a unified settings-card UI kit, a project key and a set of locale helpers — imported by plugins, never enabled by users.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jayyuen66/dsh-plugin-shared"><img src="https://img.shields.io/npm/v/@jayyuen66/dsh-plugin-shared?style=flat-square&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@jayyuen66/dsh-plugin-shared"><img src="https://img.shields.io/npm/d18m/@jayyuen66/dsh-plugin-shared?style=flat-square" alt="npm downloads (total)" /></a>
  <a href="https://github.com/JayYuen666/dsh-plugin-shared/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/JayYuen666/dsh-plugin-shared/ci.yml?branch=main&style=flat-square&label=ci" alt="ci" /></a>
  <img src="https://img.shields.io/badge/license-MIT-4c1?style=flat-square" alt="MIT" />
  <img src="https://img.shields.io/badge/node-%5E24.22.3%7C%7C%3E%3D26.13.1-4c1?style=flat-square&logo=nodedotjs&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/dsh-%5E0.2.3--alpha.2-658EFF?style=flat-square" alt="dsh" />
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="powered by dsh" /></a>
</p>

<p align="center">
  <img src="https://skillicons.dev/icons?i=typescript,nodejs,vitest,githubactions" alt="tech stack" />
</p>

<p align="center">
  <a href="https://github.com/JayYuen666"><img src="https://img.shields.io/badge/GitHub-JayYuen666-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" /></a>
  <a href="mailto:cqwkkj@gmail.com"><img src="https://img.shields.io/badge/Email-cqwkkj@gmail.com-EA4335?style=flat-square&logo=gmail&logoColor=white" alt="Email" /></a>
  <a href="https://twitter.com/JayYuen666"><img src="https://img.shields.io/badge/Twitter-X%2FJayYuen666-000000?style=flat-square&logo=x&logoColor=white" alt="Twitter/X" /></a>
  <a href="./README.zh-CN.md"><img src="https://img.shields.io/badge/lang-简体中文-658EFF?style=flat-square" alt="简体中文" /></a>
</p>

**A [dsh](https://github.com/deepseek-ai/deepseek-harness) library package: the runtime modules and lint/test baselines shared by one author's plugin family. It is only imported by plugin packages; users never enable it.**

## <img src="https://api.iconify.design/lucide/file-text.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Contents

- [ Contents](#-contents)
- [ What it does](#-what-it-does)
  - [What belongs here](#what-belongs-here)
- [ Install](#-install)
  - [Dependency requirements](#dependency-requirements)
  - [Shared version floor](#shared-version-floor)
  - [What ships](#what-ships)
- [ Verify it is live](#-verify-it-is-live)
- [ What it does not provide](#-what-it-does-not-provide)
- [ Modules](#-modules)
- [ The config exports](#-the-config-exports)
- [ Known boundaries](#-known-boundaries)
- [ Data and privacy](#-data-and-privacy)
- [ Versioning and compatibility](#-versioning-and-compatibility)
- [ FAQ](#-faq)
- [ Development](#-development)
- [ Feedback](#feedback)
- [ License](#-license)

## <img src="https://api.iconify.design/lucide/shield.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> What it does

- **It is a library plus one client row, not a standalone bundle.** The host half is imported by the plugins; `package.json` declares `dsh.client` and exports `./client`, which each consumer enables from its own `cordis.patch.yml` with `- id: dsh-plugin-shared`. It carries no `dsh.bundle.patch`, so installing the package alone adds no profile layer and no settings card or route. The fixed id makes the row visible as one component; keep it enabled. Disabling it removes every settings card's shared component supplier, and the next page load fails with `missed the module table`. When several consumers insert the same id, the host marks the switch as not uniquely locatable and disables it.
- **The two import surfaces are deliberate and exclusive.** Host/tool-side runtime code imports from `./tool`; the browser client half imports from `./client`. The old `./tool/<module>` and `./lib/<module>` runtime aliases are removed — only build helpers keep `./lib/build-*`, `./lib/decorator-lowering`, `./lib/canonicalize-region-paths` and `./config/*`. A single `./tool` barrel keeps one import line while `dist/tool.js` re-exports the 20 tool modules; a `browser` condition points the same specifier at `dist/tool-browser.js` for dual-use sources, so a client bundle never pulls `node:fs` / `node:crypto` through the barrel. There is one extra **build-time internal surface**, `./internal/tool/*`: consumer build scripts use it with `dist/tool-map.json` to split named `/tool` imports into stable modules, while source code still writes only `/tool`; consumer source must never import this internal surface directly. The consumer side calls `toolImportTransform` from `./lib/build-tool-imports`, which supplies the type-only narrowing, entry-shape and re-export guard that the official `@rolldown/plugin-transform-imports` does not cover; the consumer injects the official plugin and its own `parseAst`.
- **It holds the parts the plugins repeated verbatim:**
  - The tool-event record table (`./tool`): one scan from `SessionEvent[]` to call and result tables, PTC sub-calls included, plus `editPathOf` for the edit targets the record can see and `applyPatchTargetsOf` / `editPathsOf` for every write target in a multi-file `apply_patch` input, parsed by the official `dsh-fs-patch`.
  - Client card base components (exported by `./client`): an apply idempotency guard across HMR, and a form-value diff that treats `null`, `undefined` and an absent key as the same value.
  - Runtime utilities (the single `./tool` barrel: `tool-events`, `project-key`, `locale`, `lesson-bus`, `text`, `record`, `errors`, `jsonl`, `job-outcome`, `path-scope`, `value`, `session-cwd`, `number`, `cli-safety`, `remote-marker`, `instance-lock`, `skill`, `placeholder`, `session-projection`, `with-timeout`): the small logic every plugin would otherwise rewrite.
  - Build-time and check baselines (`./lib/canonicalize-region-paths`, `./config/*`): artifact path normalization plus the oxlint, vitest and tsconfig starting points for every consumer.
- **It handles the generic part; domain decisions stay out.** Which tools count as edits, path filtering, budgets and when a check should fail stay in the plugins. The shared layer makes no judgement about the domain handed to it.

### What belongs here

- **Verbatim duplication is the admission rule.** The same body in two or more places. A family that looks similar but differs in failure semantics, caching or override behavior stays where it is.
- **Domain judgement stays out.** A predicate that depends on a plugin's own tool list, policy or user-facing wording is not boilerplate, even when it appears twice.
- **The published interface is a commitment.** Adding a module means adding the re-export to the correct barrel (root, `./tool` or `./client`; build helpers stay subpath-only), a builder entry and a test; there is no per-module runtime subpath to add, and `tsconfig.build.json` picks up `lib/**/*.ts` by glob. The consistency checks in Development fail if a barrel, export or builder entry is missed.

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Install

```sh
npm install @jayyuen66/dsh-plugin-shared
# or
pnpm add @jayyuen66/dsh-plugin-shared
```

Declare it as an ordinary dependency of your plugin package and import it by bare-package subpath:

```ts
import { isRecord, fieldOf } from "@jayyuen66/dsh-plugin-shared/tool";
```

End users do not install or enable it separately: any consumer package pulls it in. When it is missing, the failure is `ERR_MODULE_NOT_FOUND` on a `@jayyuen66/dsh-plugin-shared/...` specifier, never a silent downgrade. There is no default export; import named exports from the barrel or a subpath.

| Requirement | Value |
| --- | --- |
| Node.js | `^24.22.3 || >=26.13.1` — the host's own floor, copied verbatim: Node 24 from 24.22.3, or 26.13.1 and later; Node 25 is outside the window, exactly as on the host |
| dsh | `^0.2.3-alpha.2`, declared as an **optional** peer (importing this package does not need a host) |
| Module format | ESM only. `require()` works only where Node supports `require(esm)` |
| Tree shaking | `"sideEffects": false` |

- **The host window rolls.** This package is verified against the exact development line pinned in `devDependencies`; the ranges in `engines.dsh` and in the peers are an install gate and a compile-time discipline, not the verification scope. Moving the window means moving those pins, re-running the host parity check and republishing.

### Dependency requirements

`dependencies` contains exactly one exception, `@deepseek-ai/dsh-fs-patch`; every other `@deepseek-ai/*` entry lives only in `peerDependencies` and `devDependencies`. `test/publish-manifest.test.ts` enforces this, and the reason is a boot-time failure rather than style:

- **`@deepseek-ai/dsh-fs-patch` is the one allowed runtime dependency.** It is a stateless pure parser: it holds no service instance or module-level identity, so a duplicate copy cannot split a `Symbol`. Shipping it makes `apply_patch` syntax resolvable on every host in the supported window. Every other host package stays in peer/dev.
- **A host package under `dependencies` disables the consumer's host.** Profiles install with `nodeLinker: hoisted` and `autoInstallPeers: false`, so a listed host package is materialized as a real directory next to the copy the host process already loaded. `@deepseek-ai/dsh-tools` keys its tool-runtime scheduler with a plain `Symbol` (not `Symbol.for`), so symbol identity is per module instance: the host reads the scheduler from the duplicate and gets `undefined`, and every native tool call throws. Build, typecheck and tests pass up to that point; the invariant has to be stated in the manifest.
- **`@deepseek-ai/dsh-output-retention` is the one required peer.** It is a value import (`truncateEnd`), provided by the host at runtime, and marked `"optional": false` in `peerDependenciesMeta` rather than left implicit — a peer left out of that table is a hard requirement for npm 7+.
- **The remaining peers are optional.** Except for the bare `@deepseek-ai/dsh` peer, which only declares the host line, most carry type declarations only. Two subpath-scoped value peers are the exceptions: `react` is value-imported by `./client`, and `@deepseek-ai/dsh-typert-protocol` by `./tool`; both stay optional, so only a consumer of that subpath needs the package present. `devDependencies` holds the exact development line, including `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-util-values`, whose types are reached through `dsh-session`, plus `@deepseek-ai/dsh-tool-executor-ptc`, whose PTC types it re-exports, and `@deepseek-ai/dsh-tools`, which types `ToolErrorIdentity`. Profiles never install peers, so no duplicate appears.
- **Version requirements separate the install gate from the build baseline.** Every `@deepseek-ai/dsh-*` peer carries the same window as `engines.dsh` — `^0.2.3-alpha.2`, a single host line. A caret's prerelease comparison only covers its own patch tuple, so `^0.2.3-alpha.2` admits `0.2.3-alpha.2` and later releases and prereleases on the `0.2` line, but not `0.2.2` or anything earlier; the host's own comparison passes `{includePrerelease:true}`, which is what lets same-tuple prereleases participate. The cost is measured and belongs here: npm resolves each peer on its own, while the host family pins its own line inside every member (`0.2.3-alpha.2` asks cordis `~4.2.0-alpha.1` and schemastery `~3.20.0-alpha.1`), so a consumer that pins an older host line can still stop at `ERESOLVE`, while the same tree resolves on the supported line. pnpm — the installer this workspace supports, and the one behind the host's `dsh plugin add` — resolves both shapes and only prints a peer warning. The loading gate is unaffected either way, because the host compares `engines.dsh` with `includePrerelease: true`. `devDependencies` pin the exact line this repository compiles and tests against (`0.2.3-alpha.2`) and must stay uniform: one `dsh-session` version per tree keeps the nominal types recognizable. `@deepseek-ai/cordis` stays exact in `devDependencies` (`4.2.0-alpha.1`); its peer range is the same single caret window, `^4.2.0-alpha.1`, with no `||` union left to read. The install-matrix probe enumerates the shipped `exports` map at run time instead of a hard-coded list. `test/publish-manifest.test.ts` checks each of these separately.
- Known upstream type-graph requirement: the published `./tool` declaration reaches `@deepseek-ai/dsh-util-values` and `@deepseek-ai/dsh-llm` through `dsh-session`, and names `@deepseek-ai/dsh-tool-executor-ptc` and `@deepseek-ai/dsh-tools` directly; a consumer running with `skipLibCheck: false` must have all of them resolvable. The former limitation (`dsh-llm` declarations importing an undeclared `dsh-attachment`) no longer reproduces on the pinned `0.2.3-alpha.2` line — a `skipLibCheck: false` import of `./tool` passes. The two `tool-events` consumers (`dsh-danger-guard` and `dsh-quality-gate`) pin the latter two packages in `devDependencies` so their own strict type checks resolve them.

### Shared version floor

A consumer profile can lock this package with a pnpm `overrides` entry. Lock it below the version that introduced `./tool` or `./client` and the host boots with `N entries did not activate` plus `does not provide an export named ...`: the package installs, never loads, and no per-repository CI run sees it. Check this package's `exports` and CHANGELOG before locking.

### What ships

- `main` and `exports` point at `dist/` only; there is no second, source-shaped manifest. Node throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for `.ts` inside `node_modules`, which is exactly where a published package is loaded from, so an artifact is mandatory.
- `files` is `icon.svg`, `dist`, `config/*.json` and `README.zh-CN.md`. npm always adds `package.json`, `LICENSE` and `README.md`; the Chinese copy is listed explicitly so it ships too.
- `publishConfig` carries `access` and `registry` and nothing else. Entry fields there are a trap: pnpm merges them onto the top level when publishing and npm does not, so one publisher would ship a package whose entry points name files that are not in the tarball.
- `build` deletes `dist/` first, then emits the runtime, client, config and build artifacts plus the type declarations. `tsc` also emits the root barrel declarations (`dist/types/index.d.ts` and `dist/types/plugin.d.ts`), so the `types` condition of `exports["."]` names the same barrel as the runtime `dist/plugin.js` (including `name` and `apply`). There is no generated hand-written root `.d.ts`, and no runtime `dist/index.js` — `dist/plugin.js` already carries the flattened named exports. `build-host` prunes only the artifacts it owns, by relative path: root-level `.js` (except `client.js`), the legacy root `index.d.ts`, and the whole `build/` subtree, so a host-only rebuild cannot leave a hash-changed chunk behind; `config/` and `types/` belong to other steps. `build-host`, `build-config` and `build-client` minify; `test/dist-size.test.ts` keeps the runtime, client, config and build artifacts inside their separate budgets.
- `prepare` runs `build`. It does not run when a consumer installs from the registry; it exists so packing, publishing and workspace links always ship a fresh `dist/`.
- Adding a runtime module means touching the correct barrel (`lib/index.ts` for a root-barrel module, `lib/tool.ts` for a tool-side module, `lib/client-entry.ts` for a browser-client module), `exports`, the correct build list in `build-host.mjs` (`facets` for a root-barrel module, `entries` for a tool-only or client-only one), and a `test/<module>.test.ts`; `tsconfig.build.json` includes `lib/**/*.ts` by glob, so it needs no per-module edit. **Decide its side first**: a tool-side module is re-exported from `lib/tool.ts` and reaches consumers through the single `./tool` barrel; a browser-client module is exported from `lib/client-entry.ts` through `/client` and client UI source must use `./client`, not `./tool`. A tool-only module (like `instance-lock`, `skill`, `placeholder` or `remote-marker`) is still re-exported by `lib/tool.ts`; its own artifact stays in `entries`. A build-time module (like `decorator-lowering`) goes into `buildFacets`. The consistency checks in Development fail if a barrel, export or builder entry is missed.

### Package-local on-demand chunks

Besides the single-entry `buildClientBundle`, `./lib/build-client` exports `buildClientArtifacts`: declare a few **package-local chunks** next to the entry, so a heavy optional dependency (a chart library, a document parser) is fetched when the user actually opens that page instead of inflating every consumer's `client.js`.

```ts
const artifacts = await buildClientArtifacts({
  root: import.meta.dirname,
  rolldown,
  header,
  chunks: [{ source: "src/insights-charts.ts", fileName: "client.insights-charts.js" }],
});
await Promise.all(artifacts.map((a) => writeArtifact(path.join(root, a.fileName), a.text)));
```

- **The caller references a chunk by a literal specifier**: write `require.async("./client.insights-charts.js")` in the source and the host derives the chunkId from that string. File names are therefore given by the caller, not derived from a content hash — a hash would force the entry to be rewritten, and artifacts would stop matching the source character for character.
- **Every artifact gets its own build pass.** A single multi-entry pass makes rolldown split shared code into an extra chunk and reference it with a **synchronous** `require("./client.common.js")`; the host module table has no such package-relative synchronous edge, so that edge always misses at runtime. The cost is one copy of the shared code per chunk.
- **Five build-time gates**, each closing a silently failing runtime shape: a file name outside the host's `client.<name>.js` rule (`/plugins/<id>/<fileName>` answers 404), a name that collides with the `client.node.*` reserved names, the same name declared twice, a declaration that no `require.async` references (the bundle grows while that page never loads), and a cross-chunk synchronous `require`. The last gate runs first: when artifacts really do have a static edge, the runtime misses on it even if the entry also wrote `require.async`.
- **Chunks must be listed in `files` yourself.** This package returns the text (`ClientArtifact[]`) and neither writes files nor edits the manifest; the omission shows up as a working local link and a 404 on the registry install.

### Externalisation rules

`clientExternalPatterns(externals)` and `clientReactGuard(externals)` hold the one externalisation decision shared by the build and by each consumer's self-check:

```ts
const artifacts = await buildClientArtifacts({
  root: import.meta.dirname,
  rolldown,
  header,
  externals: [...REACT_RUNTIME_MODULES, "zod", "@jayyuen66/dsh-plugin-shared/client"],
});
```

- **Bare package names generalise; registered subpaths match exactly.** `"zod"` produces `^zod(?:/|$)`, `"<shared>/client"` produces `^<shared>/client$`. The latter must not generalise to the whole package: the host module table looks keys up by exact specifier, so generalising would externalise an unregistered `<shared>/lib/record` too and leave a `require` in the artifact that always misses at load time.
- **The react family never enters the `external` array**; `clientReactGuard` handles it through a `resolveId` hook: registered specifiers get `{ id, external: true }`, unregistered ones **throw**. A regex that matches during the `isResolved:false` pass stops the plugin from being asked at all, so combining the two shapes hides each other — an unregistered `react-dom/server` would be silently externalised to a key the host module table does not have.
- **A sixth build-time gate, `assertStaticRequires`,** catches externalisation drift: a static `require("<specifier>")` in an artifact that is neither relative nor absolute nor in the package's list fails the build. It catches the "package registered, subpath not registered" case — build, typecheck and pack all pass, and only the host reports `missed the module table` at load time.
- **Legal comments survive minification**: `comments` defaults to `{ legal: true, annotation: false, jsdoc: false }`, so `/*!` licence headers travel with third-party code; pass `comments: false` explicitly to strip everything. `codeSplitting: false` and `dynamicImportInCjs: false` are pinned at the same time, so the defaults cannot turn a dynamic import into an extra chunk referenced by a **synchronous** `require`.

## <img src="https://api.iconify.design/lucide/circle-check.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Verify it is live

1. **A subpath resolves.** From the consuming package, `node -e 'import("@jayyuen66/dsh-plugin-shared/tool").then((m) => console.log(typeof m.isRecord))'` prints `function`. `ERR_MODULE_NOT_FOUND` means the dependency is not installed; `does not provide an export named ...` means the installed copy is older than the subpath you import.
2. **The barrel resolves.** The same check against the bare package name returns the runtime modules. `canonicalize-region-paths` (build-time), `instance-lock` / `skill` / `placeholder` / `session-projection` / `with-timeout` (no generic barrel consumer), `remote-marker` (value-imports typert), `typert-client` (type-only references to typert), and `card-ui` (client-only, folded into `./client`) are deliberately absent from the barrel; take them from `./tool` or `./client`. The only per-module **runtime** subpaths are the internal `./internal/tool/*` entries used by consumer build scripts; build helpers keep their `./lib/build-*`, `./lib/decorator-lowering` and `./lib/canonicalize-region-paths` subpaths, and consumer source must not import any of them directly.
3. **A consumer host boots.** Start the profile that declares the plugin. A boot log containing `N entries did not activate` and `does not provide an export named ...` means the profile's `overrides` version is below the version that contains the subpath the consumer imports — raise the version, do not patch the plugin.
4. **Local source edits reach the consumer.** Consumers load `dist/`, not `lib/`. Run `pnpm run build` after editing; `test/build-host.test.ts` compares the runtime artifacts on disk against an in-memory build and fails when they are stale. "The code changed but nothing happened" is almost always a stale artifact, not a caching bug.

## <img src="https://api.iconify.design/lucide/circle-slash.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> What it does not provide

- **No bundle declaration.** It declares `dsh.client` for the client row but no `dsh.bundle.patch`; a copy in `node_modules` is not a profile layer by itself. Consumers enable the row from their own patch.
- **No settings card of its own.** The client row exports card components; the package registers no card, owns no client state and serves no route.
- **No HTTP route and no request-trust checks.** The host's `/api` gateway owns authentication, the Host / Origin checks and body limits for the plugins that do register a route.
- **No CLI subcommand and no model tool.**
- **No domain judgement.** It does not know which tool counts as an edit, which path is secret, how large a budget is, or when a check should fail. Those belong to the calling plugin.

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Modules

The subpath column is the in-package specifier; value imports prefix it with the bare package name. `exports` also carries `./package.json`, which the host reads for display metadata.

Runtime code has exactly two sides, plus two non-runtime entry groups:

| Side | Specifier | Used by | Artifact shape |
| --- | --- | --- | --- |
| Host / tool | `./tool` | `host.ts`, `lib/`, Node-side tests and build scripts | one barrel over 20 `dist/<module>.js` files; `browser` condition selects the pure subset |
| Browser client | `./client` | client entries, readers and settings cards under `src/` | one `__ModuleLoader__` UMD row; client UI code does not reach into `./tool` |
| Build / check helpers | `./lib/build-*`, `./lib/build-tool-imports`, `./lib/decorator-lowering`, `./lib/canonicalize-region-paths`, `./config/*` | build scripts, lint / vitest / tsconfig | non-runtime |
| Build-time tool split | `./internal/tool/*` | consumer `build-host.mjs` via `toolImportTransform` + official transform | driven by `dist/tool-map.json`; not a public API, source must not import it directly |

| Subpath | Provides |
| --- | --- |
| `.` | Barrel over the runtime modules that do enter it, served from `dist/plugin.js`: their exported names plus `name` and a no-op `apply`, so the host loader can also take this package as a row. `canonicalize-region-paths` (build-time), `instance-lock` / `skill` / `placeholder` / `session-projection` / `with-timeout` (no generic barrel consumer), `remote-marker` (value-imports typert), `typert-client` (type-only references to typert), and `card-ui` (client-only, folded into `./client`) deliberately stay out; the root barrel must not pull an unused package into every consumer. |
| `./tool` · `tool-events` | `scanToolEvents` returns the `calls` / `results` tables, PTC sub-calls included; `toolEventRowsOf` handles a single event and already carries normalized `arguments` and `badArguments`. `editPathOf` returns a `kind`-discriminated `EditTarget` with only `write` / `read-view`; the path is `undefined` when it cannot be read. `applyPatchTargetsOf` parses the ordered operations of an `apply_patch` input with the official `dsh-fs-patch`; `editPathsOf` expands every write target, including both sides of a move. Record fields are `readonly`; `arguments` is a deep snapshot — platform `structuredClone` separates it from the event completely, then JSON objects/arrays are frozen layer by layer (non-JSON objects are cloned but their internal slots are not claimed frozen). Each result row also carries the structured failure identity `error` from the event's `data.error` (`name` and `code` must be non-empty strings; a partial shape reads as absent, and `reason` is kept only when it is a string). Re-exports the official `SessionEvent` and the two PTC payloads — the truth source for `PtcDispatchStartEventData` / `PtcDispatchEventData` and the `SessionEventMap` augmentation is `@deepseek-ai/dsh-tool-executor-ptc/types` (the official declarations carry the augmentation); this module only re-exports the names, its local declarations are gone. |
| `./client` · `card-apply` | `claimApply` + `CardApplyCtx`: an apply idempotency guard built on an **own** flag on `globalThis` (a symbol, or `true` written by an outside holder) with `ctx.effect` cleanup. The slot must be a configurable data property; accessors and non-protocol values throw instead of being overwritten. The flag is shared across one `globalThis` (one realm), so a second context on the same page is rejected by design. |
| `./client` · `card-diff` | `formValueEquals` compares two form values with the card rules: `undefined`, `null` and an absent key are one value; arrays and objects compare element by element; cycles terminate. `diffTouched` returns the touched fields whose effective value differs from the snapshot. |
| `./client` · `card-form` | React-free card draft skeleton: `numberBoundsOf` reads explicit `minValue` / `maxValue` from a zod number schema (with an optional two-sided fallback); `withDraftField` writes one touched cell without mutating the input; `effectiveField` reads the draft first and falls back to the snapshot through `Object.hasOwn` + `Reflect.get`, so an explicit `undefined` draft and inherited names (`constructor` / `__proto__`) behave correctly. |
| `./client` · `card-ui` | Client-only settings-card kit, on the v3 visual baseline. Form layer: `CardForm`, `Section` (optional `count` badge, `toggle` section switch and `actions` slot next to the title), `FieldGrid`, `FieldTwoCol`, `StatusBar`, `Field` / `FieldLabel` / `InfoTip` (label row above the control; `hint` and `detail` live only in the 24px help button's popover; a validation error appears as a truncated label-row badge and its full text is repeated in that popover, so a field never grows a third line; `TipPlacement` is `side` for fields and `above` for section titles), `ToggleField`, `SectionToggle`, `ToggleGrid` / `ToggleCell`, `TextField`, `SecretField` (password input with an in-field eye button; `revealToken` returns it to masked after a discard), `NumberField`, `ListField`, `SelectField` (`bare` drops the Field shell for table cells and headers), `SaveBar`, `splitHint`, `withInvalidField`, `useInvalidFields`, `useCardDraft` (plus the `CardDraft` / `CardDraftOptions` types — one touched-layer state hook keyed by `Object.hasOwn`, with an optional per-field parser; it never reads inherited names), the `InvalidFields` type. Display layer (introduced in v2): `Badge` (optional `dot` tone and `data-field`) / `StatusDot` (optional `label`, so a dot-only status cell stays readable), `Callout`, `KpiGrid` / `KpiTile`, `DataTable` (the `ellipsis` column pops the full text through a `createPortal` overlay on hover; optional `stickyFirst` freezes the first column and `caption` supplies the screen-reader table name) / `Meter`, `LogPanel`, `Segmented`, `EmptyState` (tray icon; `plain` drops the dashed frame), `ToolRow` / `ToolRowGrid` / `ToolRowItem`, plus the `CARD_UI_CSS` string. `SaveBar`'s optional `blocked` prop disables saving while keeping discard available. The four input components (`TextField` / `SecretField` / `ListField` / `NumberField`) each keep an internal draft and follow the outer value: while focused the outer value is not adopted, after blur the draft follows, and across rows you must key entries by their id, or instance reuse carries the previous row's draft and error into the next one. `CARD_UI_STYLE_ID` and `ensureCardUiCss` inject that stylesheet idempotently under one fixed `<style id="dsh-card-ui-css">`; the reference count lives on the style element, so separately bundled consumers share one copy, and an existing tag without that count is treated as foreign and never removed. Control DOM ids come from a process-local counter (`nextDomId`) rather than React `useId`, so a consumer test that renders through its own light hook layer still gets working `label[for]` wiring; `SecretField` derives its input id from the field key. Built with `createElement` and `createPortal` only; `react` is an optional peer (`^18.2.0 || ^19.0.0`; the host runtime is React 18.3.1), `react-dom` is used only by the overlay portal and declared in `devDependencies` alone (the artifact keeps the bare specifier, served at runtime by the host platform module next to `react`), and the kit never enters the root barrel. |
| `./client` | Browser client row: the `__ModuleLoader__` bundle the host module graph serves once. It also carries the client-side reader skeleton (`remoteMounterOf` / `parseOrThrow` and their `RemoteHost` / `RemoteMounter` / `SafeParse*` types), `raceTimeout`, `clampInt`, so browser code has one import surface instead of reaching into `./tool`. Consumers externalize this specifier and enable the row from their own patch with `id: dsh-plugin-shared`; the row must stay enabled — disabling it removes the cards' shared component supply, and the next page load fails with `missed the module table`. |
| `./tool` · `project-key` | `deriveProjectKey` + `ProjectKeyOptions`: cwd → `last-segment-<first 8 hex of sha256(norm)>`, with `default` for a non-string, an empty string or a normalized root. `realpathSync` resolves symlinks; a failure falls back to the resolved path. Windows `\` and `/` produce the same key; extended namespace prefixes are classified before the root check, so `\\?\C:\repo` no longer falls into `default`. |
| `./tool` · `locale` | `Locale` (an alias of the official `BuiltInLocaleId`), `DEFAULT_LOCALE`, `resolveLocale`, `resolveLocalePreference`, `messagesFor`, `MessagesCatalog`, plus `LOCALE_SETTINGS_NAMESPACE` / `LOCALE_PREFERENCE_FIELD`. Host-side dictionaries only; the client uses the official locale package. |
| `./tool` · `lesson-bus` | `settleLessonCall`: routes synchronous throws and asynchronous rejections into one `onFailure` exit. Function-valued thenables count as awaitable; an `onFailure` that itself throws or rejects is handled in the same place, so it never splits into "thrown at the caller" or "unhandled rejection". |
| `./tool` · `text` | `truncateEnd` delegates to the official `truncateWithoutSplittingSurrogatePair`; `truncateStart` is the back-cut form the official exports do not provide. Both are surrogate-pair safe; a budget below one code unit (including `<= 0` and NaN) returns an empty string. `truncateCodePoints` budgets by code point instead, so an emoji or combined character counts as one (`NaN` and `<= 0` yield an empty string; `Infinity` returns the whole string). |
| `./tool` · `record` | `isRecord`, `fieldOf`, `hasMethods`, `hasOptionalMethods`, `isArrayValue`, `arrayOf`. `fieldOf` reads through the prototype chain by design (cordis service methods are defined there); a read that hits a malicious getter or Proxy trap returns `undefined` instead of throwing. `hasMethods` requires every named method to be a function in this read and does not accept `Object.prototype` members as a service implementation; an empty method list proves nothing and returns `false` (use `isRecord` for a pure object check). `hasOptionalMethods` also rejects non-function values but treats an absent method as valid. `isArrayValue` narrows to `unknown[]` without copying; `arrayOf` returns an array unchanged or an empty array for any non-array value — a required-array field must validate before calling it. |
| `./tool` · `errors` | `errorText` follows the official `@deepseek-ai/dsh-llm` `errorChain` semantics (cause chain, `AggregateError` members, empty message → `name`, cross-realm `message`, malicious getters render as a placeholder) in a zero-dependency local implementation. `isSettingsConflict` recognizes the host's settings-conflict pattern from `code` / `name`, so a cross-realm error is still recognized. `isErrnoCode` / `isEnoent` read a Node errno identity from `code` (the latter matches `ENOENT` only), without narrowing on `message` text. |
| `./tool` · `path-scope` | The single "is this absolute path inside that root" judgement: `isPathInside` / `isAncestorDirOf` compare path segments (so a child literally named `..cache` is not mistaken for an escape) and take the platform `path` API as an argument, so Windows semantics are testable on macOS. `normalizeAbsolutePath` lexically resolves `.` / `..` and rejects a `..` that crosses the filesystem root; `assertAbsoluteRoot` adds type, non-empty, NUL, platform-absolute and not-filesystem-root checks. Callers pass their own localized rejection messages. |
| `./tool` · `value` | Zero-dependency `unknown` → text/regex conversion. `asText` accepts strings only and returns `""` otherwise; `asDisplayText` also stringifies numbers and booleans for display but still returns `""` for objects, bigint and symbol; `escapeRegExp` escapes the regex metacharacters without adding anchors or flags. |
| `./tool` · `number` | `versionAtLeast` compares `{ major, minor, patch }` numerically per segment (not as strings, so `0.10.0 > 0.9.0`); `clampInt` sends non-finite values to the fallback, otherwise truncates and clamps into a closed interval. |
| `./tool` · `session-cwd` | `WorkingDirectoryFace` / `WorkingDirectoryService`, `isWorkingDirectory` (optional `get`, for callers that use `service.get?.()` and fall back), `isWorkingDirectoryService` (strict: `get` must be a function), `sessionWorkingDirectory` (live `ctx.get("workingDirectory")` first, then `session.header.cwd`) and `SessionCwdAgent`. The flexible guard exists because a service may be half-installed; dir-prep uses the strict one because its public `workingDirectoryOf` contract hands the service to callers that do not re-check it. |
| `./tool` · `cli-safety` | `shq(value, platform = "posix")` puts an arbitrary string in single quotes for `bash` / `sh` or PowerShell (`win32`), refusing NUL because the shell cannot read it back. Single-quoted content is literal in both shells; only the embedded-quote form differs (`'\''` vs `''`). |
| `./tool` · `jsonl` | `shrinkJsonlTail`: pure decision logic for JSONL tail shrinking. The trigger policy and error handling stay with the caller; the byte budget is the caller's responsibility to keep finite. |
| `./tool` · `job-outcome` | `jobOutcomeOf` + `SettledProcess` + `JobOutcome` map a finished subprocess onto the official job registry's outcome; a completed outcome also carries the official `exitCode`, so the job list can draw its warning dot for a non-zero exit. `killProc` + `KillableProcess` release a child handle and ignore a `kill()` that throws or rejects (for example, on an already-reaped process). |
| `./tool` · `instance-lock` | `claimInstance(ctx, key)` + `InstanceLockContext`: a single-instance claim for one cordis scope, built on `ctx.reflect.provide` and released with the owning fiber. It exists because the market hot-mount path and the profile's bundle layer can each `apply()` the same plugin once in the same process — tools, prompt sections and `Service` constructors all throw on a duplicate, so the second assembly must step aside instead of failing. It stays out of the root barrel and carries no imports. |
| `./tool` · `skill` | `registerSkill(ctx, spec)` + `SkillSpec`: registers one virtual skill through the optional `skills` service, always filling `source` (default `"runtime"`) because the host's `validateDefinition()` requires it at load time. Empty content is not registered; an absent or malformed service returns `false` instead of throwing. Stays out of the root barrel. |
| `./tool` · `placeholder` | `fillPlaceholders(template, values)` + `PlaceholderValues`: one-pass `{name}` interpolation. Missing or `undefined` values keep the placeholder, `null` renders as `"null"`, and only own properties are read (keys may contain dots, so `{gate.command}` works). Stays out of the root barrel. |
| `./tool` · `remote-marker` | `markRemote(prototype, methodName)`: the programmatic equivalent of the official `@Remote` method decorator. It applies the same decorator function to a hand-built TC39 context, so a source file can avoid decorator syntax and needs no lowering pipeline. It value-imports `@deepseek-ai/dsh-typert-protocol` (an optional peer) and stays out of the root barrel. |
| `./client` · `typert-client` | The common skeleton of Typert Remote client readers: the `RemoteHost` / `RemoteMounter` types, the `isRemoteMounter` guard, `remoteMounterOf(ctx, strict = false)` (try-read `remote`, fold every failure into "no channel"), and the schema-agnostic `SafeParseSuccess` / `SafeParseFailure` / `SafeParseResult` / `SafeParser` types with `parseOrThrow(schema, value, describe)`. Each of the repositories used to carry a verbatim copy in its reader face; descriptors, codec, namespace constants, unwrap strictness and error wording stay with each repository. `parseOrThrow` takes the error formatter as an argument, so this package still adds no zod dependency. Its type face references `@deepseek-ai/dsh-typert-protocol` (the same reason it stays out of the root barrel). |
| `./tool` · `session-projection` | Discriminators for the two generations of the `ctx.sessionProjections` registration protocol: `ProjectionHandle` / `isDisposer` / `isProjectionHandle` and `discriminateProjection`, with a fixed order (handle before disposer — treating callability as a handle exclusion would drop a synthetic "callable + carries stateOf/dispose" value into the legacy path). Zero imports; the mounting bodies of both repositories (opposite failure semantics, fail-open / fail-fast) stay in place. Stays out of the root barrel. |
| `./tool` · `with-timeout` | `raceTimeout<Value>(promise, timeoutMs, onTimeout)`: the race skeleton for "wait with a deadline, stop waiting when it passes, let the underlying operation keep running". The timer is cleared on both the success and the timeout path, leaving no idle timer behind; `onTimeout` builds the rejection value at the deadline (wording and error types belong to the caller), and the underlying operation cannot be aborted and finishes in the background. Zero dependencies, zero imports. Stays out of the root barrel. |
| `./lib/decorator-lowering` | Build/test helper for standard decorators: `needsDecoratorLowering`, `lowerStandardDecorators`, `rolldownDecorators`, `viteDecorators`, and `tscFailureHeadOf` (the failure head for a signal-terminated or non-zero-exit tsc run). It runs the caller-injected `tsc` entry on one file with `--noResolve`, preserves module specifiers, returns code plus a source map, and (on the Vite side) prunes injected plumbing from coverage mappings. Build-time only, never in the runtime barrel. |
| `./lib/canonicalize-region-paths` | Build-time string helper: resolves rolldown's `// <path>` (production build) and `//#region <path>` (HMR payload) markers against an explicit base, then classifies the target by full path segments. Internal builders **no longer call it** — rolldown's `cwd` is pinned to the package root; the subpath remains for external build scripts that cannot control `cwd`, and is single-pass only. |

`instance-lock`, `skill`, `placeholder`, `session-projection` and `with-timeout` are runtime modules with no generic root-barrel consumer; `card-ui` (value-imports `react`, now only exported through `./client`), `remote-marker` (value-imports `@deepseek-ai/dsh-typert-protocol`) and `typert-client` (type-only references to the same package) also stay out of the root barrel so every host-side importer does not resolve a package it does not use. They are still reachable through the single `./tool` or `./client` surface. The old client compatibility rows (`./lib/card-apply`, `./lib/card-diff`, `./lib/card-form`, `./lib/card-ui`, `./lib/typert-client`) are deleted; browser code takes their exports from `./client`.

The client row is enabled by the consuming plugin, not by installing this package alone. The consumer writes `- id: dsh-plugin-shared` next to `- name: "@jayyuen66/dsh-plugin-shared"` in its own `cordis.patch.yml`. The fixed id is deliberate: the host then shows the row as one component, and that component must stay enabled — switching it off removes the card components' supply and the next page load fails with `missed the module table`. When several consumers insert the same id, the host marks that switch as not uniquely locatable and disables it; the module graph still materializes one copy.

## <img src="https://api.iconify.design/lucide/sliders-horizontal.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> The config exports

These are lint/test baselines for plugin authors, not runtime code. They pull in tooling your package must provide itself:

| Subpath | Provides | You must install |
| --- | --- | --- |
| `./config/oxlint` | `definePluginConfig`, `makeTestFileOverrides`, `OFF_JUSTIFICATIONS` and the shared rule baseline | `oxlint`, `eslint-plugin-sonarjs`, `eslint-plugin-regexp`, `eslint-plugin-zod` (requires zod 4), `@e18e/eslint-plugin` |
| `./config/vitest.base` | `definePackageConfig`: four 100% coverage thresholds, a 20-second test timeout, the shared coverage exclusions, the test include globs, the `@jayyuen66/dsh-plugin-shared/client` → the package-local `dist/client-entry.js` alias (the UMD row reads `window` at load time, so a Node test cannot execute it; the target is the published ESM artifact because `files` ships `dist` only), `react` / `react-dom` resolved by `resolve.dedupe` alone (no cwd-derived filesystem aliases, so `react/jsx-runtime` and `react-dom/client` keep the package's exports mapping), the shared package inlined into Vite's module pipeline so a consumer's `vi.mock("react")` reaches the components instead of being bypassed by Node's loader, `undefined` coverage entries treated as inherit (never as "no threshold"), `test.server.deps.inline` allowed only to grow, `test.coverage` rejected at load, and every `coverageInclude` pattern checked against the resolved test root so a moved source tree fails the run instead of passing with nothing to measure | `vitest` and `@vitest/coverage-v8` (the baseline sets `coverage.provider: "v8"`) |
| `./config/tsconfig.base.json`, `./config/tsconfig.client.base.json` | Plain JSON for `extends` | Nothing |

Those toolchain packages are **not** declared as `peerDependencies`: npm 7+ tries to satisfy optional peers too, and `oxlint`'s own `peerOptional vite-plus` locks `vitest` to a version disjoint from `>=5.0.2`, which made a plain `npm install` of this package fail with `ERESOLVE`. The requirement is stated here instead of in the manifest.

- All four JS plugin entry points (sonarjs / regexp / zod / e18e) are resolved lazily inside `definePluginConfig()`. Importing `./config/oxlint` without any of them succeeds; calling `definePluginConfig()` throws only when that plugin is neither installed nor supplied through `jsPlugins`, and the message names the specifiers it tried plus how to provide your own entry.
- `e18e/prefer-static-regex` is enabled only on production paths (`lib/**`, `src/**`, `host.ts`, `cli-main.ts`); regex literals in tests and build scripts are not treated as defects. The measured counts and rationale live in `OFF_JUSTIFICATIONS`.
- Every rule turned `off` in the baseline needs a `kind` + `measured` + `note` entry in `OFF_JUSTIFICATIONS`, or configuration loading throws. A package-level exception goes in that package's own `offReasons`.
- `definePackageConfig` refuses an empty `coverageInclude` and refuses a `test.coverage` block: either one would silently drop the four thresholds or the coverage statistics. An exception belongs in the package that needs it, next to its own `coverage` override.

## <img src="https://api.iconify.design/lucide/triangle-alert.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Known boundaries

One entry per class; each is fixed by a test at its current behavior.

- **`fieldOf` reads the prototype chain on purpose.** `Object.hasOwn` would make every cordis service method invisible. Code that reads a user settings value must use the own-property form instead; `resolveLocalePreference` is the example and is covered by tests in both directions.
- **`claimApply` shares one `globalThis` (one realm), not a per-context lock.** A second context applying the same card on one page is rejected. A consumer that needs multiple contexts must manage its contexts itself rather than "fixing" this protection. An iframe or worker realm has its own `globalThis` and does not share the flag.
- **`shrinkJsonlTail` does not normalize the budget.** `NaN` and `+Infinity` disable shrinking entirely; `0`, negative values and `-Infinity` still shrink to at most two lines. The caller owns the trigger policy (including "0 means never trim") and the error handling.
- **`jobOutcomeOf` copies the host bash tool's wording.** The tests check the literal `exit code: N` / `signal: NAME` strings, not equality with the upstream function, which is not importable from the published package. If upstream changes its wording, this package keeps passing and its display text stays its own.
- **`editPathOf` knows one read-only spelling.** Only `str_replace_editor` with `command: "view"` is `read-view`; every other tool that carries `file_path` is `write` without further inspection.
- **The PTC payloads come from the host package.** `lib/tool-events.ts` re-exports the two payload types from `@deepseek-ai/dsh-tool-executor-ptc/types`, which also carries the `SessionEventMap` augmentation; this package no longer declares its own copies or its own augmentation. `engines.dsh` and every dsh peer now sit on one line, `^0.2.3-alpha.2`, so the window holds a single host generation and the old "the augmentation moved between host packages" rationale no longer applies. `test/tool-events-ptc-keys.ts` is the compile-time tripwire: `pnpm typecheck` fails if either key drops out of the union or the re-export breaks — a runtime assertion cannot, because the types are erased. The bare specifier survives into the published `dist/types/tool-events.d.ts`, so shared declares the package as an **optional peer**: a `./tool` consumer that never touches the PTC payloads is not asked by the installer to install it; only a consumer that references the PTC payload types or constructs PTC events itself (currently dsh-danger-guard and dsh-quality-gate) pins the package in its own `devDependencies`. `skipLibCheck` silently swallows an unresolved import, so "tsc is green" does not prove the package resolves.

## <img src="https://api.iconify.design/lucide/lock.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Data and privacy

The package is imported into a host process; the table describes run time.

| Aspect | Content |
| --- | --- |
| File access | `deriveProjectKey` calls `realpathSync` on the path you hand it, and only that path. A failure (`ENOENT` / `EACCES`) falls back to `path.resolve` and never throws. No other file access exists in the runtime modules; the build helpers read manifests and write `dist/` and a temporary tsc directory. |
| Writes | No runtime module writes a file, a cache or a log. The build helpers write `dist/` and temporary files; they are not part of the runtime surface. |
| Environment | No environment variable is read. |
| Network | No outbound request, no HTTP server, no subprocess. |
| Dynamic code | No `eval`, no `new Function`, no dynamic `import()`. |
| Process memory | The only mutable cross-instance state is the `claimApply` slot on `globalThis`, restored when the effect disposes or when claiming fails; the slot is one realm's `globalThis`, not every thread in the process. |
| Logging | At run time, `console.error` appears only when an `onFailure` callback in `lesson-bus` itself throws; a build helper logs one more line when releasing a rolldown bundle fails (both are registered in `test/log-templates.ts`), and the test setup checks every `[shared/*]` line against that template list. |

## <img src="https://api.iconify.design/lucide/layers.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Versioning and compatibility

- **Semantic versioning applies to the public interface**: subpaths, exported value symbols, exported types, and error/reason enums. `0.x` ranges admit patches only, so touching any of those is already breaking under the ranges consumers wrote.
- **0.3.0 is a breaking release, not a patch.** It removed the `./tool/<module>` / `./lib/<module>` runtime aliases and `./client-node`; all nine consumers moved in lockstep to `./tool` / `./client`. The removal is breaking: `^0.3.0` is safe only for consumers whose sources and builds no longer import the old aliases, so it is versioned 0.3.0 instead of being released as a patch. Subsequent releases follow the patch rule again: a patch must not delete exported names; breaking changes go 0.4.0 with consumers republished.
- **`deriveProjectKey`'s hash algorithm, the 8-hex slice and the trailing-segment whitespace cleaning are frozen.** Changing one digit leaves existing lessons and memories under a key that no longer matches.
- **Windows path normalization changed the key shape.** The same directory now yields `last-segment-<hash>` whether it is spelled with `\` or `/`, and a drive root or UNC share root falls into `default`. Keys written before normalization on Windows no longer match; POSIX keys are byte-for-byte unchanged and fixed by literal assertions.
- **The 0.1.7 regression on Windows extended paths is fixed.** `\\?\C:\repo`, `\\.\C:\repo` and `\\?\Volume{...}\repo` are no longer treated as UNC share roots; because the non-root hash input keeps the spelling `realpath` returns, a prefixed result returns to the 0.1.6 literal key (the test pins `\\?\C:\repo` → `repo-e8b99b5c`), while a host that strips the prefix gets the ordinary key instead. `\\?\C:\`, `\\.\C:\` and `\\?\Volume{...}` return to `default` instead of a fake `C:-...` / `Volume{...}-...` key. The extended and ordinary spellings are not folded by this function; with a prefixed `realpath` result they remain two keys. Prefix folding is a separate key-format change that needs old-key samples and the peer's rule.
- **`Locale` is an alias of the official `BuiltInLocaleId`**, so it tracks the host's `LOCALE_IDS` instead of a hand-written union.
- **`errorText` returns display text, not a parseable format.** It follows the official `errorChain` semantics: a cause chain renders as `outer: inner`, an `AggregateError` appends `[e1; e2]`, an empty message falls back to `Error.name`, and a cross-realm `Error` yields its own `message` instead of `String()`'s `"Error: ..."`. Callers that regex it are outside the supported usage.
- **`editPathOf` returns a `kind`-discriminated `EditTarget` with only `write` / `read-view`.** `"skip"` was never produced; keeping it in the type only pushed consumers into unreachable branches. When no path can be read it still returns the matching arm with `path: undefined`.
- **`./lib/http` and `./lib/trust` are gone.** The plugin family's settings-card data plane runs on the official Typert Remote, whose `/api` gateway owns authentication, the Host / DNS-rebinding / Origin checks and the body cap. A plugin that still wants a raw `webServer` route has to write these checks itself — the published package no longer offers a second, divergent answer to "is this request allowed".
- **The declarations are compiled against one host line and installed across a peer window.** `devDependencies` lock the exact `@deepseek-ai/*` line used for build and test; the dsh peer family and `engines.dsh` share the supported range, so a host inside that window is accepted without a second build. Moving the window means updating the development pins, re-running the parity check and republishing. Widening the peer range past the verified window is not supported.

## <img src="https://api.iconify.design/lucide/circle-help.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> FAQ

| Question | Answer |
| --- | --- |
| Should I `dsh plugin add` it? | No. It declares `dsh.client` for the row consumers enable, but carries no `dsh.bundle.patch`, so adding it as a plugin installs no profile layer and enables nothing by itself. Declare it as a dependency of the plugin package, insert `- id: dsh-plugin-shared` in your own `cordis.patch.yml`, and keep that component enabled. |
| A consumer boots with `does not provide an export named ...` and `N entries did not activate`. | The profile is serving an older copy of this package than the consumer imports. Raise the profile's `overrides` entry to a version that contains the subpath the consumer imports; check this package's `exports` and CHANGELOG. No per-repository CI run can see this state. |
| I changed `lib/*.ts` and the consumer still runs the old behavior. | Consumers load `dist/`. Run `pnpm run build`; `test/build-host.test.ts` fails if the runtime artifact is stale. A workspace link does not bypass the artifact. |
| Why is `@deepseek-ai/dsh-output-retention` a required peer while the rest are optional? | It is the only **required** host package imported for value (`truncateEnd`). `@deepseek-ai/dsh-typert-protocol` is also value-imported, but only by `./tool`, so it stays optional; the remaining dsh peers are type-only. The bare `@deepseek-ai/dsh` peer only declares the host line, and `react` is a value peer for `./client`. |
| Why isn't `oxlint` a `peerDependency`? | npm 7+ would try to satisfy it, and `oxlint`'s optional `vite-plus` peer locks `vitest` outside the range this baseline needs, producing `ERESOLVE` for a plain install. The requirement is documented instead. |
| Want a helper added here? | First confirm the body repeats verbatim in two or more packages. Domain judgement stays in the plugins. |

## <img src="https://api.iconify.design/lucide/wrench.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Development

```sh
pnpm install
pnpm run check   # typecheck → lint → build → test → format check
pnpm test        # vitest with coverage
pnpm run build   # runtime artifacts, config artifacts, declarations, client row
```

- The suite splits by the class of defect a stub cannot see:
  - **Module behavior**: one `test/<module>.test.ts` per runtime module.
  - **Surface parity**: `test/index.test.ts` (barrel ↔ `lib/` value exports), `test/publish-manifest.test.ts` (`exports` ↔ `lib/` in both directions) and `test/build-host.test.ts` (`build-host.mjs` `facets` ↔ `lib/`). Each catches an omission the other two cannot see. `test/tool-events-ptc-keys.ts` is the declaration-side counterpart: a type-level assertion that the two PTC keys stay in `SessionEventMap` and that the re-export still resolves to the official types; it has no runtime case because a type assertion is erased before vitest can judge it; `pnpm typecheck` runs it.
  - **Artifact checks**: `test/build-host.test.ts` compares the runtime artifacts on disk with an in-memory build byte for byte and requires the official value import to stay a bare specifier, rejecting runtime specifiers for `dsh-jobs` / `dsh-shell`; `test/dist-size.test.ts` holds the runtime, client, config and build artifacts to their separate byte budgets.
  - **Config checks**: `test/config-oxlint.test.ts` compares the vitest rule snapshot with `oxlint --rules` and requires every `off` to be justified; `test/vitest-base.test.ts` requires the merge behavior that keeps the four thresholds and the coverage statistics, pins the client alias to a published artifact (never a source path), pins the React family to `dedupe` with no filesystem aliases, and covers `undefined` inheritance, the append-only inline rule, the `test.coverage` rejection and the zero-match `coverageInclude` census.
  - **Log records**: `test/setup-logs.ts` takes over `console.*`; every `[shared/*]` line must match `test/log-templates.ts` or the run fails. `test/log-templates.test.ts` checks both directions, so adding or deleting a log without updating the record list fails.
  - **Published shape**: `test/publish-manifest.test.ts` requires every export target to be inside `files`, entry points to be artifacts rather than source, `publishConfig` to carry no entry fields, every peer to be stated in `peerDependenciesMeta`, every `dsh-*` development pin to be exact and uniform, every dsh peer range to equal `engines.dsh`, and the source, docs and artifacts to carry no dates, absolute paths, home-directory references or collaboration-only wording.
- Coverage thresholds are **100%** across lines, statements, functions and branches, so a new branch needs a case that reaches it. `test/vitest-base.test.ts` refuses an empty `coverageInclude` because that would make the four thresholds pass over nothing.
- CI runs the checks on Linux, Windows and macOS on Node 24.22.3, with a weekly scheduled run to catch upstream changes. The install matrix packs with both npm and pnpm, installs into a clean directory without peer-resolution flags, imports every subpath and type-checks a small consumer import under both `skipLibCheck` settings.

## Feedback

Issues and pull requests are welcome: [https://github.com/JayYuen666/dsh-plugin-shared/issues](https://github.com/JayYuen666/dsh-plugin-shared/issues).

If a plugin fails to boot, include the dsh host version, the profile install shape, and the browser console line. The `missed the module table` line is especially useful: it tells us whether the shared client row was materialized.

## <img src="https://api.iconify.design/lucide/scale.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> License

MIT. Source at [github.com/JayYuen666/dsh-plugin-shared](https://github.com/JayYuen666/dsh-plugin-shared). `LICENSE` ships with the package.
