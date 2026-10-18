# @jayyuen66/dsh-plugin-shared

[English](./README.md) · [简体中文](./README.zh-CN.md)

## What this package is

A **library package** shared by one author's dsh plugin family. It is only `import`ed, never enabled by users.

- `package.json` carries no `dsh` field and the package directory has no `cordis.patch.yml`, so sitting in `node_modules` it is never registered as a plugin.
- No settings card, no client half, no `/_dsh` route of its own.
- Admission rule: a piece of boilerplate is only pulled in when it repeats **verbatim** in two or more places. Domain judgement (which tools count as edits, path filtering, budgets, gate logic) stays in the plugins — this layer marks, it does not decide.

## Install

Published on the public npm registry, so installing needs no credentials.

```sh
npm install @jayyuen66/dsh-plugin-shared
# or
pnpm add @jayyuen66/dsh-plugin-shared
```

Declare it as an ordinary dependency of your plugin package and import it by bare-package subpath:

```ts
import { isRecord, fieldOf } from "@jayyuen66/dsh-plugin-shared/lib/record";
```

End users do not install or enable it separately: any consumer package pulls it in. When it is missing the failure is `ERR_MODULE_NOT_FOUND` on a `@jayyuen66/dsh-plugin-shared/...` specifier, never a silent downgrade.

## Requirements

| | |
| --- | --- |
| Node.js | `>=22.12.0` — the publish-side floor the nine-package family shares, so a plugin that declares the same `engines.node` never rejects this library |
| dsh | `^0.2.1-rc.2`, declared as an **optional** peer (this package needs no host at import time) |
| Module format | ESM only. `require()` works only where Node supports `require(esm)` |
| Tree shaking | `"sideEffects": false` |

### What it touches at run time

| Behaviour | Where | Scope |
| --- | --- | --- |
| Reads a directory entry through `realpathSync` | `lib/project-key.ts` | Only the path handed to `deriveProjectKey`; a failure (ENOENT/EACCES) falls back to `path.resolve` and never throws |
| Reads nothing else | — | No other file access in `lib/**`, no writes at all, no environment variables read, no outbound network requests, no `eval`/`new Function`/dynamic import |

`lib/card-apply.ts` reads and writes one `globalThis` key by design — that is what survives a duplicated module instance under HMR.

## Modules

The subpath column is the in-package specifier; value imports must prefix it with the bare package name. `exports` also carries `./package.json`, which the host reads for display metadata.

| Subpath | Provides |
| --- | --- |
| `.` | Barrel over the runtime facets listed below. `canonicalize-region-paths` deliberately stays out, so no runtime consumer pays an import for it |
| `./lib/tool-events` | `scanToolEvents` → the `calls`/`results` tables, `toolEventRowsOf` (its single-event step, same code), `parseToolArguments`, `toolArgumentsBad` (the pair a self-folding consumer needs, so it never re-reads the arguments fields), `editPathOf` and `EditTarget` (discriminated on `kind`, only `write` / `read-view`; `path` is `undefined` when no path could be read); every field of the three ledger interfaces is `readonly`; re-exports the official `SessionEvent` and the two PTC event types |
| `./lib/card-apply` | `claimApply` + `CardApplyCtx`: apply idempotency guard (`globalThis` flag plus `ctx.effect` cleanup) |
| `./lib/card-diff` | `diffTouched`: which touched fields really differ from the snapshot (value comparison, so `undefined`, `null` and an absent key are one and the same value) |
| `./lib/project-key` | `deriveProjectKey` + `ProjectKeyOptions`: cwd → `last-segment-<first 8 hex of sha256(norm)>`, fallback bucket `default` |
| `./lib/locale` | `Locale` (an alias of the official `BuiltInLocaleId`), `DEFAULT_LOCALE`, `resolveLocale`, `resolveLocalePreference`, `messagesFor`, `MessagesCatalog`, plus `LOCALE_SETTINGS_NAMESPACE` / `LOCALE_PREFERENCE_FIELD` |
| `./lib/lesson-bus` | `settleLessonCall`: routes synchronous throws and asynchronous rejections into one `onFailure` exit; function-thenables count as awaitable (missing them leaves a rejection unhandled); an `onFailure` that itself throws is contained, so it never forks into "thrown at the caller" or "unhandled rejection" |
| `./lib/text` | `truncateEnd` (delegates to the official `truncateWithoutSplittingSurrogatePair`) and `truncateStart` (back cut; the official surface has no back-cut form) |
| `./lib/record` | `isRecord`, `fieldOf`, `hasMethods` (service-surface check: the value is a record **and** every named method is callable) |
| `./lib/errors` | `errorText`: semantics aligned with the official `@deepseek-ai/dsh-llm` `errorChain` (cause chain, `AggregateError` members, empty message falling back to `name`, cross-realm `message` read off the value itself, hostile getters degraded), implemented locally with zero dependencies; `isSettingsConflict` recognizes the host's settings-conflict shape from `code` / `name`, so a cross-realm error still classifies |
| `./lib/jsonl` | `shrinkJsonlTail`: the pure decision half of JSONL tail halving; trigger policy and error exit stay with the caller |
| `./lib/job-outcome` | `jobOutcomeOf` + `SettledProcess` + `JobOutcome`: maps a settled subprocess onto the official job registry's outcome; `killProc` + `KillableProcess` terminates a child handle and ignores a `kill()` that throws on an already-reaped process |
| `./lib/canonicalize-region-paths` | Build-time string helper that folds rolldown's `//#region <path>` markers into a `process.cwd()`-independent form. Exported as a subpath precisely because runtime consumers should not pay an import for it |

## The `config/` facets

These are lint/test baselines for plugin authors, not runtime code. They pull in tooling your package must provide itself:

| Subpath | Needs installed |
| --- | --- |
| `./config/oxlint` | `oxlint`, and `eslint-plugin-sonarjs` if you want the sonarjs rule set mounted |
| `./config/vitest.base` | `vitest`, plus `@vitest/coverage-v8` because the baseline sets `coverage.provider: "v8"` |
| `./config/tsconfig.base.json`, `./config/tsconfig.client.base.json` | Nothing — plain JSON for `extends` |

Those three tools are **not** declared as `peerDependencies`. npm 7+ tries to satisfy optional peers too, and `oxlint`'s own `peerOptional vite-plus` pins `vitest` to a version disjoint from `>=5.0.2`, which made a plain `npm install` of this package fail with `ERESOLVE`. The requirement is therefore stated here instead of in the manifest.

The sonarjs entry point is resolved lazily, inside `definePluginConfig()`. Importing `./config/oxlint` without sonarjs installed succeeds; calling `definePluginConfig()` throws a message naming both specifiers it tried and the `jsPlugins` escape hatch.

`definePackageConfig` imposes 100% coverage thresholds on four metrics and a 20-second test timeout. It will not relax them for you: an exception belongs in the package that needs it, with a reason.

## Dependencies

`dependencies` is empty; every `@deepseek-ai/*` entry lives only in `peerDependencies` and `devDependencies`. `test/publish-manifest.test.ts` enforces this — it is not a style preference:

- **Putting them in `dependencies` disables the consumer's host.** Consumers are dsh plugins installed into a profile (`nodeLinker: hoisted`, `autoInstallPeers: false`). Any host package listed under `dependencies` is written into the profile as a **real directory**, coexisting with the copy the host process already loaded. `@deepseek-ai/dsh-tools` keys its `TOOL_RUNTIME_SCHEDULER` with a plain `Symbol` (not `Symbol.for`), so symbol identity is per module instance: the host's `dsh-agent-loop` reads a `ToolRuntime` mounted from the duplicate using its own copy's symbol, gets `undefined`, and **every native tool call throws** `Cannot read properties of undefined (reading 'prepare')` — the whole profile loses its tools. This package's build, typecheck and tests all stay green right up to that point, so the invariant has to live in the manifest.
- `@deepseek-ai/dsh-output-retention` is a **value** import (`truncateEnd`) and is provided by the host at runtime, so it is the one required peer — stated as `"optional": false` in `peerDependenciesMeta` rather than left implicit, because an unlisted peer is a hard requirement for npm 7+ (`ERESOLVE`, not a warning).
- The remaining peers are referenced only by the published `.d.ts`, so they are optional peers plus devDependencies: the peer keeps the type surface honest — `lib/job-outcome` used to take `ShellProcess` and `JobOutcome` from packages no consumer tree was required to contain, so with `skipLibCheck: true` a wrong `status` or `exitCode` produced no error at all and `jobOutcomeOf`'s return type collapsed to `any` — while devDependencies let this repository compile and test. Profiles never install peers, so no duplicate appears.
- Versions follow the host: exact pins throughout the `dsh-*` family and for `cordis`, matching what the host bundle itself declares so the same copy is reused rather than duplicated.

Known upstream limitation: `@deepseek-ai/dsh-llm`'s own declarations import `@deepseek-ai/dsh-attachment`, which it does not declare. It is reached transitively through `dsh-session`, so a consumer running with `skipLibCheck: false` sees `TS2307` from *that* package, not from this one.

## Published form

`main` and `exports` point at `dist/` only. There is no second, source-shaped manifest.

- `publishConfig` carries `access` and `registry` and nothing else. Putting `main`/`exports` there was wrong: pnpm merges those onto the top level when publishing and npm does not, so publishing with npm shipped a package whose fourteen entry points named files that were not in the tarball.
- `files` is `icon.svg`, `dist`, `config/*.json`, `README.zh-CN.md`. npm always adds `package.json`, `LICENSE` and `README.md`; `README.zh-CN.md` is listed explicitly so the Chinese copy ships too.
- `build` starts by deleting `dist/`, because `files` takes the whole directory and a renamed facet would otherwise keep publishing its orphan artifact.
- `prepare` runs `build`. It does not run when a consumer installs from the registry; it exists so packing, publishing and workspace links always ship a fresh `dist/`.
- Node throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for `.ts` inside `node_modules`, which is exactly where a published package is loaded from, so an artifact is mandatory. The barrel's declaration file is generated by `build-host.mjs` because source-form `export * from "./record.ts"` specifiers are not resolvable by consumers.
- Adding a facet means touching three places: `exports`, the `facets` array in `build-host.mjs`, `include` in `tsconfig.build.json`, plus `test/<module>.test.ts`.

## Versioning and compatibility

- Semantic versioning applies to the public surface: subpaths, exported value symbols, exported types, and error/reason enums. `0.x` ranges admit patches only, so touching any of those is already breaking under the ranges consumers wrote.
- `deriveProjectKey`'s hash algorithm, the 8-hex slice and the trailing-segment whitespace cleaning are the untouchable part: changing one digit moves existing lessons and memories out of their buckets.
- Windows path normalization changed the bucket key shape. On Windows the same directory now yields `last-segment-<hash>` regardless of whether it is spelled with `\` or `/`, and a drive root falls into `default`. **Windows buckets written before normalization no longer match**; POSIX buckets are byte-for-byte unchanged and are pinned by literal assertions in `test/project-key.test.ts`.
- `Locale` is now an alias of the official `BuiltInLocaleId` instead of a hand-written union, so it tracks the host's `LOCALE_IDS`.
- **`errorText` now returns more text** (same name and signature). It went from a single `message` layer to the official `errorChain` semantics: a cause chain renders as `outer: inner`, an `AggregateError` appends `[e1; e2]`, an empty message falls back to `Error.name`, and a cross-realm `Error` yields its own `message` instead of `String()`'s `"Error: ..."`. **Callers that regex the old text must re-check** (a `exec` that pulls a number out of parentheses, for example).
- `editPathOf` returns a `kind`-discriminated `EditTarget` with only `write` / `read-view`: `"skip"` was never produced, and leaving it in the type only pushed consumers into writing unreachable branches. When no path can be read it still returns the matching arm with `path` set to `undefined`.
- **`./lib/http` and `./lib/trust` are gone.** The plugin family's settings-card data plane moved onto the official Typert Remote, whose `/api` gateway owns authentication, the Host / DNS-rebinding / Origin checks and the body cap; the two facets kept a hand-written copy of rules the host now enforces. No consumer package imports them any more. A plugin that still wants a raw `webServer` route has to write the gate itself — that is deliberate: the published surface no longer offers a second, divergent answer to "is this request allowed".

## Quality gates

- `npm run check` = typecheck → lint → build → test (coverage thresholds 100 for lines, statements, functions and branches) → format check.
- `test/publish-manifest.test.ts` is the release-shape gate: every `exports` target must be inside what `files` actually ships, entries must point at build output rather than source, and `publishConfig` must not carry entry fields. It also pins **facet/`exports` parity in both directions**: every `lib/*.ts` needs a matching subpath (a missing one means that facet is not importable by any consumer, while the build — which follows the builder's own entries array — stays green), and no dangling subpath may outlive its facet. And it pins **peer optionality**: every `peerDependencies` entry must appear in `peerDependenciesMeta`, because a peer left out of that table is a hard requirement for npm 7+ consumers while typecheck, build, tests and the parity checks all stay green. `./lib/canonicalize-region-paths` is the one facet that lives in `exports` but not in the barrel, and that subpath is load-bearing: the sibling packages' rolldown `build-*.mjs` import it (every sibling except the Python-bridge package), so removing it breaks their builds at once. One set of "internal reference" patterns scans **both planes**: **artifacts** must contain no absolute paths, home-directory references, dates, or sibling-package identifiers; **source and docs** must contain no dates and no "this round / next round" wording that only made sense during collaboration. The artifact pass cannot see comments, so the source pass is what keeps that cleanup from being a one-off.
- `test/build-host.test.ts` compares the bytes on disk against an in-memory build, so editing `lib/*.ts` without rebuilding goes red.
- `test/setup-logs.ts` (a vitest setup file) is the ledger for runtime logs: it takes over `console.*`, so the `console.error` calls left in `lib/` neither leak into the test report (that stack trace is pure noise) nor go unclaimed — every `[shared/*]` line must match a template fragment in `test/log-templates.ts` or the run goes red. Do not substitute vitest's `silent`: it only hides, and a newly added log would still go unnoticed.
- `.github/workflows/ci.yml` runs the gate on push and pull request across a Node matrix and on Windows; the install matrix there additionally packs, installs into a clean directory with no flags, imports every subpath and type-checks a consumer probe.

## FAQ

- **Should I `dsh plugin add` it?** No. It has neither a config layer nor a client half, so there is nothing to enable; declare it as a dependency.
- **`401`/`403` when publishing** usually means the npm token lacks publish rights. `404` means the package or version is not there yet.
- **I changed this package and nothing happened.** In local development through a workspace link, consumers load `dist/`, so rebuild first (`npm run build`); a stale artifact is what the freshness gate catches.
- **Want something shared here?** First confirm the duplication really is verbatim. Anything carrying domain judgement stays in the plugins.

## License

MIT. `LICENSE` ships with the package.
