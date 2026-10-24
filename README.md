<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/JayYuen666/dsh-plugin-shared@main/icon.svg" width="96" height="96" alt="dsh-plugin-shared logo" />
</p>

<h1 align="center">dsh-plugin-shared</h1>

<p align="center"><em>The shared library behind the dsh plugin family: one tool-event ledger, one set of card skeletons, one project key and one locale surface — imported by plugins, never enabled by users.</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jayyuen66/dsh-plugin-shared"><img src="https://img.shields.io/npm/v/@jayyuen66/dsh-plugin-shared?style=flat-square&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@jayyuen66/dsh-plugin-shared"><img src="https://img.shields.io/npm/dm/@jayyuen66/dsh-plugin-shared?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/JayYuen666/dsh-plugin-shared/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/JayYuen666/dsh-plugin-shared/ci.yml?branch=main&style=flat-square&label=ci" alt="ci" /></a>
  <img src="https://img.shields.io/badge/license-MIT-4c1?style=flat-square" alt="MIT" />
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-4c1?style=flat-square&logo=nodedotjs&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/dsh-%5E0.2.1--rc.2-658EFF?style=flat-square" alt="dsh" />
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

**A [dsh](https://github.com/deepseek-ai/deepseek-harness) library package: the runtime facets and lint/test baselines shared by one author's plugin family. It is only imported by plugin packages; users never enable it.**

## <img src="https://api.iconify.design/lucide/file-text.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Contents

- [What it does](#what-it-does)
- [Install](#install)
- [Verify it is live](#verify-it-is-live)
- [What it does not provide](#what-it-does-not-provide)
- [Modules](#modules)
- [The config facets](#the-config-facets)
- [Known boundaries](#known-boundaries)
- [Data and privacy](#data-and-privacy)
- [Versioning and compatibility](#versioning-and-compatibility)
- [FAQ](#faq)
- [Development](#development)
- [License](#license)

## <img src="https://api.iconify.design/lucide/shield.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> What it does

- **It is a library, not a plugin.** `package.json` carries no `dsh` field and the package has no `cordis.patch.yml`, so a copy sitting in `node_modules` is never registered as a plugin. There is no settings card, no client half and no route of its own.
- **It holds the parts the plugins repeated verbatim:**
  - The tool-event ledger (`./lib/tool-events`): one scan from `SessionEvent[]` to call and result tables, PTC sub-calls included, plus `editPathOf` for the edit targets the ledger can see.
  - Client card skeletons (`./lib/card-apply`, `./lib/card-diff`): apply idempotency across HMR, and a form-value diff that treats `null`, `undefined` and an absent key as the same value.
  - Runtime plumbing (`./lib/project-key`, `./lib/locale`, `./lib/lesson-bus`, `./lib/text`, `./lib/record`, `./lib/errors`, `./lib/jsonl`, `./lib/job-outcome`): the small decisions every plugin would otherwise rewrite.
  - Build-time and gate baselines (`./lib/canonicalize-region-paths`, `./config/*`): artifact canonicalization plus the oxlint, vitest and tsconfig starting points for every consumer.
- **It marks; it does not decide.** Which tools count as edits, path filtering, budgets and gate logic stay in the plugins. The shared layer has no opinion about the domain it is handed.

### What belongs here

- **Verbatim duplication is the admission rule.** The same body in two or more places. A family that looks similar but differs in failure semantics, caching or override shape stays where it is.
- **Domain judgement stays out.** A predicate that depends on a plugin's own tool list, policy or user-facing wording is not boilerplate, even when it appears twice.
- **The published surface is the contract.** Adding a facet means adding a subpath, a barrel re-export (except the build-time helper), a builder entry, the build `include` and a test; the parity gates in Development fail if one is missed.

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Install

```sh
npm install @jayyuen66/dsh-plugin-shared
# or
pnpm add @jayyuen66/dsh-plugin-shared
```

Declare it as an ordinary dependency of your plugin package and import it by bare-package subpath:

```ts
import { isRecord, fieldOf } from "@jayyuen66/dsh-plugin-shared/lib/record";
```

End users do not install or enable it separately: any consumer package pulls it in. When it is missing, the failure is `ERR_MODULE_NOT_FOUND` on a `@jayyuen66/dsh-plugin-shared/...` specifier, never a silent downgrade. There is no default export; import named symbols from the barrel or a subpath.

| Requirement | Value |
| --- | --- |
| Node.js | `>=22.12.0` — the publish-side floor the plugin family shares, so a package declaring the same `engines.node` never rejects this library |
| dsh | `^0.2.1-rc.2`, declared as an **optional** peer (importing this package does not need a host) |
| Module format | ESM only. `require()` works only where Node supports `require(esm)` |
| Tree shaking | `"sideEffects": false` |

### Dependency contract

`dependencies` is empty; every `@deepseek-ai/*` entry lives only in `peerDependencies` and `devDependencies`. `test/publish-manifest.test.ts` enforces this, and the reason is a boot-time failure rather than style:

- **A host package under `dependencies` disables the consumer's host.** Profiles install with `nodeLinker: hoisted` and `autoInstallPeers: false`, so a listed host package is materialized as a real directory next to the copy the host process already loaded. `@deepseek-ai/dsh-tools` keys its tool-runtime scheduler with a plain `Symbol` (not `Symbol.for`), so symbol identity is per module instance: the host reads the scheduler from the duplicate and gets `undefined`, and every native tool call throws. Build, typecheck and tests stay green up to that point; the invariant has to live in the manifest.
- **`@deepseek-ai/dsh-output-retention` is the one required peer.** It is a value import (`truncateEnd`), provided by the host at runtime, and marked `"optional": false` in `peerDependenciesMeta` rather than left implicit — a peer left out of that table is a hard requirement for npm 7+.
- **The remaining peers are optional.** Except for the bare `@deepseek-ai/dsh` peer, which only declares the host line, they are load-bearing only for types. Keeping them in `peerDependencies` makes the published `.d.ts` honest; `devDependencies` let this repository compile and test. Profiles never install peers, so no duplicate appears.
- **Versions follow the host.** `dsh-*` and `cordis` are pinned exactly to what the host bundle declares, so the same copy is reused. `test/publish-manifest.test.ts` also requires every `dsh-*` pin to match the `@deepseek-ai/dsh` peer version.
- Known upstream limitation: `@deepseek-ai/dsh-llm`'s declarations import `@deepseek-ai/dsh-attachment`, which that package does not declare. It is reached through `dsh-session`, so a consumer running with `skipLibCheck: false` sees `TS2307` from that package, not from this one.

### Shared version floor

A consumer profile can pin this package with a pnpm `overrides` entry. Pin it below the version that introduced a `./lib/...` subpath and the host boots with `N entries did not activate` plus `does not provide an export named ...`: the package installs, never loads, and no per-repository CI run sees it. Check this package's `exports` and CHANGELOG before pinning.

### What ships

- `main` and `exports` point at `dist/` only; there is no second, source-shaped manifest. Node throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for `.ts` inside `node_modules`, which is exactly where a published package is loaded from, so an artifact is mandatory.
- `files` is `icon.svg`, `dist`, `config/*.json` and `README.zh-CN.md`. npm always adds `package.json`, `LICENSE` and `README.md`; the Chinese copy is listed explicitly so it ships too.
- `publishConfig` carries `access` and `registry` and nothing else. Entry fields there are a trap: pnpm merges them onto the top level when publishing and npm does not, so one publisher would ship a package whose entry points name files that are not in the tarball.
- `build` deletes `dist/` first, then emits the runtime artifacts, the config artifacts, the type declarations and the generated barrel declaration. Both builders minify; `test/dist-size.test.ts` keeps each plane inside its budget.
- `prepare` runs `build`. It does not run when a consumer installs from the registry; it exists so packing, publishing and workspace links always ship a fresh `dist/`.
- Adding a facet means touching five places: the barrel in `lib/index.ts`, `exports`, the `facets` array in `build-host.mjs`, `include` in `tsconfig.build.json`, and a `test/<module>.test.ts`. The parity gates in Development fail if one is missed.

## <img src="https://api.iconify.design/lucide/circle-check.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Verify it is live

1. **A subpath resolves.** From the consuming package, `node -e 'import("@jayyuen66/dsh-plugin-shared/lib/record").then((m) => console.log(typeof m.isRecord))'` prints `function`. `ERR_MODULE_NOT_FOUND` means the dependency is not installed; `does not provide an export named ...` means the installed copy is older than the subpath you import.
2. **The barrel resolves.** The same check against the bare package name returns the runtime facets. `canonicalize-region-paths` is the one facet deliberately absent from the barrel; import it by subpath when a build script needs it.
3. **A consumer host boots.** Start the profile that declares the plugin. A boot log containing `N entries did not activate` and `does not provide an export named ...` means the profile's `overrides` pin is below the version that contains the subpath the consumer imports — raise the pin, do not patch the plugin.
4. **Local source edits reach the consumer.** Consumers load `dist/`, not `lib/`. Run `pnpm run build` after editing; `test/build-host.test.ts` compares the runtime artifacts on disk against an in-memory build and fails when they are stale. "The code changed but nothing happened" is almost always a stale artifact, not a caching bug.

## <img src="https://api.iconify.design/lucide/circle-slash.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> What it does not provide

- **No plugin registration.** No `dsh` field, no `cordis.patch.yml`, no layer in `--dump-config`; `dsh plugin add` is the wrong action.
- **No settings card or client half.** The package has no browser entry and no client-side state.
- **No HTTP route and no trust gate.** The host's `/api` gateway owns authentication, the Host / Origin checks and body limits for the plugins that do register a route.
- **No CLI subcommand and no model tool.**
- **No domain judgement.** It does not know which tool counts as an edit, which path is secret, how large a budget is, or when a gate should fire. Those belong to the calling plugin.

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Modules

The subpath column is the in-package specifier; value imports prefix it with the bare package name. `exports` also carries `./package.json`, which the host reads for display metadata.

| Subpath | Provides |
| --- | --- |
| `.` | Barrel over the runtime facets below. `canonicalize-region-paths` deliberately stays out, so a runtime consumer does not pay an import for it. |
| `./lib/tool-events` | `scanToolEvents` returns the `calls` / `results` tables, PTC sub-calls included; `toolEventRowsOf` is the same step for one event and already carries normalized `arguments` and `badArguments`. `editPathOf` returns a `kind`-discriminated `EditTarget` with only `write` / `read-view`; the path is `undefined` when it cannot be read. Ledger fields are `readonly`. Re-exports the official `SessionEvent` and the two PTC event types. |
| `./lib/card-apply` | `claimApply` + `CardApplyCtx`: an apply idempotency guard built on an **own** flag on `globalThis` (a symbol, or `true` written by an outside holder) with `ctx.effect` cleanup. The flag is process-wide, so a second context on the same page is blocked by design. |
| `./lib/card-diff` | `diffTouched`: which touched fields really differ from the snapshot, compared by form value. `undefined`, `null` and an absent key are one value; arrays and objects compare element by element; cycles terminate. |
| `./lib/project-key` | `deriveProjectKey` + `ProjectKeyOptions`: cwd → `last-segment-<first 8 hex of sha256(norm)>`, with `default` for a non-string, an empty string or a normalized root. `realpathSync` collapses symlinks; a failure falls back to the resolved path. Windows `\` and `/` fold to the same bucket. |
| `./lib/locale` | `Locale` (an alias of the official `BuiltInLocaleId`), `DEFAULT_LOCALE`, `resolveLocale`, `resolveLocalePreference`, `messagesFor`, `MessagesCatalog`, plus `LOCALE_SETTINGS_NAMESPACE` / `LOCALE_PREFERENCE_FIELD`. Host-side dictionaries only; the client uses the official locale package. |
| `./lib/lesson-bus` | `settleLessonCall`: routes synchronous throws and asynchronous rejections into one `onFailure` exit. Function-valued thenables count as awaitable; an `onFailure` that itself throws or rejects is contained, so it never forks into "thrown at the caller" or "unhandled rejection". |
| `./lib/text` | `truncateEnd` delegates to the official `truncateWithoutSplittingSurrogatePair`; `truncateStart` is the back-cut form the official surface does not provide. Both are surrogate-pair safe; a budget below one code unit (including `<= 0` and NaN) returns an empty string. |
| `./lib/record` | `isRecord`, `fieldOf`, `hasMethods`. `fieldOf` reads through the prototype chain by design (cordis service methods live there); a hostile getter or Proxy trap degrades to `undefined`. `hasMethods` requires every named method to be callable and does not accept `Object.prototype` members as a service implementation. |
| `./lib/errors` | `errorText` follows the official `@deepseek-ai/dsh-llm` `errorChain` semantics (cause chain, `AggregateError` members, empty message → `name`, cross-realm `message`, hostile getters degraded) in a zero-dependency local implementation. `isSettingsConflict` recognizes the host's settings-conflict shape from `code` / `name`, so a cross-realm error still classifies. |
| `./lib/jsonl` | `shrinkJsonlTail`: the pure decision half of JSONL tail halving. The trigger policy and the error exit stay with the caller; the byte budget is the caller's responsibility to keep finite. |
| `./lib/job-outcome` | `jobOutcomeOf` + `SettledProcess` + `JobOutcome` map a settled subprocess onto the official job registry's outcome; `killProc` + `KillableProcess` terminate a child handle and ignore a `kill()` that throws or rejects (for example, on an already-reaped process). |
| `./lib/canonicalize-region-paths` | Build-time string helper that folds rolldown's `//#region <path>` markers into a `process.cwd()`-independent form. Exported as a subpath so build scripts can import it without putting it in the runtime barrel. |

## <img src="https://api.iconify.design/lucide/sliders-horizontal.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> The config facets

These are lint/test baselines for plugin authors, not runtime code. They pull in tooling your package must provide itself:

| Subpath | Provides | You must install |
| --- | --- | --- |
| `./config/oxlint` | `definePluginConfig`, `makeTestFileOverrides`, `OFF_JUSTIFICATIONS` and the shared rule baseline | `oxlint`; `eslint-plugin-sonarjs` if you want the sonarjs rule set mounted |
| `./config/vitest.base` | `definePackageConfig`: four 100% coverage thresholds, a 20-second test timeout, the shared coverage exclusions and the test include globs | `vitest` and `@vitest/coverage-v8` (the baseline sets `coverage.provider: "v8"`) |
| `./config/tsconfig.base.json`, `./config/tsconfig.client.base.json` | Plain JSON for `extends` | Nothing |

Those toolchain packages are **not** declared as `peerDependencies`: npm 7+ tries to satisfy optional peers too, and `oxlint`'s own `peerOptional vite-plus` pins `vitest` to a version disjoint from `>=5.0.2`, which made a plain `npm install` of this package fail with `ERESOLVE`. The requirement is stated here instead of in the manifest.

- The sonarjs entry point is resolved lazily inside `definePluginConfig()`. Importing `./config/oxlint` without sonarjs succeeds; calling `definePluginConfig()` without sonarjs and without a sonarjs entry in `jsPlugins` throws a message naming both specifiers it tried and the escape hatch.
- Every rule turned `off` in the baseline needs a `kind` + `measured` + `note` entry in `OFF_JUSTIFICATIONS`, or configuration loading throws. A package-level exception goes in that package's own `offReasons`.
- `definePackageConfig` refuses an empty `coverageInclude` and refuses a `test.coverage` block: either one would silently drop the four thresholds or the statistical surface. An exception belongs in the package that needs it, next to its own `coverage` override.

## <img src="https://api.iconify.design/lucide/triangle-alert.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Known boundaries

Registered honestly, one entry per class; each is pinned by a test at its current verdict.

- **`fieldOf` reads the prototype chain on purpose.** `Object.hasOwn` would make every cordis service method invisible. Code that reads a user settings value must use the own-property form instead; `resolveLocalePreference` is the example and is pinned in both directions.
- **`claimApply` is a process-wide flag, not a per-context lock.** A second context applying the same card on one page is blocked. A consumer that needs multiple contexts must keep its own per-context ledger rather than "fixing" this guard.
- **`shrinkJsonlTail` does not normalize the budget.** `NaN` and `+Infinity` disable shrinking entirely; `0`, negative values and `-Infinity` still shrink to at most two lines. The caller owns the trigger policy (including "0 means never trim") and the error exit.
- **`jobOutcomeOf` copies the host bash tool's wording.** The tests pin the literal `exit code: N` / `signal: NAME` strings, not equality with the upstream function, which is not importable from the published package. If upstream changes its wording, this package stays green and its display text stays its own.
- **`editPathOf` knows one read-only spelling.** Only `str_replace_editor` with `command: "view"` is `read-view`; every other tool that carries `file_path` is `write` without further inspection.

## <img src="https://api.iconify.design/lucide/lock.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Data and privacy

The package is imported into a host process; the table describes run time.

| Aspect | Content |
| --- | --- |
| File access | `deriveProjectKey` calls `realpathSync` on the path you hand it, and only that path. A failure (`ENOENT` / `EACCES`) falls back to `path.resolve` and never throws. No other file access exists in `lib/**`. |
| Writes | None. Nothing in this package writes a file, a cache or a log. |
| Environment | No environment variable is read. |
| Network | No outbound request, no HTTP server, no subprocess. |
| Dynamic code | No `eval`, no `new Function`, no dynamic `import()`. |
| Process memory | The only mutable cross-instance state is the `claimApply` slot on `globalThis`, restored when the effect disposes or when claiming fails. |
| Logging | `console.error` appears only when an `onFailure` callback in `lesson-bus` itself throws; the test setup claims every `[shared/*]` line against a template ledger. |

## <img src="https://api.iconify.design/lucide/layers.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Versioning and compatibility

- **Semantic versioning applies to the public surface**: subpaths, exported value symbols, exported types, and error/reason enums. `0.x` ranges admit patches only, so touching any of those is already breaking under the ranges consumers wrote.
- **`deriveProjectKey`'s hash algorithm, the 8-hex slice and the trailing-segment whitespace cleaning are frozen.** Changing one digit moves existing lessons and memories out of their buckets.
- **Windows path normalization changed the bucket key shape.** The same directory now yields `last-segment-<hash>` whether it is spelled with `\` or `/`, and a drive root or UNC share root falls into `default`. Windows buckets written before normalization no longer match; POSIX buckets are byte-for-byte unchanged and are pinned by literal assertions.
- **`Locale` is an alias of the official `BuiltInLocaleId`**, so it tracks the host's `LOCALE_IDS` instead of a hand-written union.
- **`errorText` returns display text, not a parseable format.** It follows the official `errorChain` semantics: a cause chain renders as `outer: inner`, an `AggregateError` appends `[e1; e2]`, an empty message falls back to `Error.name`, and a cross-realm `Error` yields its own `message` instead of `String()`'s `"Error: ..."`. Callers that regex it are outside the contract.
- **`editPathOf` returns a `kind`-discriminated `EditTarget` with only `write` / `read-view`.** `"skip"` was never produced; keeping it in the type only pushed consumers into unreachable branches. When no path can be read it still returns the matching arm with `path: undefined`.
- **`./lib/http` and `./lib/trust` are gone.** The plugin family's settings-card data plane runs on the official Typert Remote, whose `/api` gateway owns authentication, the Host / DNS-rebinding / Origin checks and the body cap. A plugin that still wants a raw `webServer` route has to write the gate itself — the published surface no longer offers a second, divergent answer to "is this request allowed".
- **The declarations are coupled to the exact host pins.** Upgrading the host means moving the exact `@deepseek-ai/*` pins in this package and republishing; widening a range would let a consumer load a type surface this package was not built against.

## <img src="https://api.iconify.design/lucide/circle-help.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> FAQ

| Question | Answer |
| --- | --- |
| Should I `dsh plugin add` it? | No. It has neither a config layer nor a client half, so there is nothing to enable. Declare it as a dependency of the plugin package. |
| A consumer boots with `does not provide an export named ...` and `N entries did not activate`. | The profile is serving an older copy of this package than the consumer imports. Raise the profile's `overrides` pin to a version that contains the subpath the consumer imports; check this package's `exports` and CHANGELOG. No per-repository CI run can see this state. |
| I changed `lib/*.ts` and the consumer still runs the old behavior. | Consumers load `dist/`. Run `pnpm run build`; `test/build-host.test.ts` fails if the runtime artifact is stale. A workspace link does not bypass the artifact. |
| Why is `@deepseek-ai/dsh-output-retention` a required peer while the rest are optional? | It is the only host package imported for value (`truncateEnd`). The rest are type-only, except the bare `@deepseek-ai/dsh` peer, which only declares the host line. |
| Why isn't `oxlint` a `peerDependency`? | npm 7+ would try to satisfy it, and `oxlint`'s optional `vite-plus` peer pins `vitest` outside the range this baseline needs, producing `ERESOLVE` for a plain install. The requirement is documented instead. |
| Want a helper added here? | First confirm the body repeats verbatim in two or more packages. Domain judgement stays in the plugins. |

## <img src="https://api.iconify.design/lucide/wrench.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> Development

```sh
pnpm install
pnpm run check   # typecheck → lint → build → test → format check
pnpm test        # vitest with coverage
pnpm run build   # runtime artifacts, config artifacts, declarations
```

- The suite splits by the class of defect a stub cannot see:
  - **Facet behavior**: one `test/<module>.test.ts` per runtime facet.
  - **Surface parity**: `test/index.test.ts` (barrel ↔ `lib/` value exports), `test/publish-manifest.test.ts` (`exports` ↔ `lib/` in both directions) and `test/build-host.test.ts` (`build-host.mjs` `facets` ↔ `lib/`). Each catches an omission the other two cannot see.
  - **Artifact gates**: `test/build-host.test.ts` compares the runtime artifacts on disk with an in-memory build byte for byte; `test/dist-size.test.ts` holds the runtime and config planes to their byte budgets; the same test pins the official value import as a bare specifier and rejects runtime specifiers for `dsh-jobs` / `dsh-shell`.
  - **Config gates**: `test/config-oxlint.test.ts` compares the vitest rule snapshot with `oxlint --rules` and requires every `off` to be justified; `test/vitest-base.test.ts` pins the merge contract that keeps the four thresholds and the statistical surface.
  - **Log ledger**: `test/setup-logs.ts` takes over `console.*`; every `[shared/*]` line must match `test/log-templates.ts` or the run goes red. `test/log-templates.test.ts` checks both directions, so adding or deleting a log without updating the ledger fails.
  - **Published shape**: `test/publish-manifest.test.ts` requires every export target to be inside `files`, entry points to be artifacts rather than source, `publishConfig` to carry no entry fields, every peer to be stated in `peerDependenciesMeta`, `dsh-*` pins to be exact and uniform, and the source, docs and artifacts to carry no dates, absolute paths, home-directory references or collaboration-only wording.
- Coverage thresholds are **100%** across lines, statements, functions and branches, so a new branch needs a case that reaches it. `test/vitest-base.test.ts` refuses an empty `coverageInclude` because that would make the four thresholds pass over nothing.
- CI runs the gate on Linux, Windows and macOS across a Node 22/24 matrix, with a weekly scheduled run for upstream drift. The install matrix packs with both npm and pnpm, installs into a clean directory without peer-resolution flags, imports every subpath and type-checks consumer probes under both `skipLibCheck` settings.

## <img src="https://api.iconify.design/lucide/scale.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> License

MIT. Source at [github.com/JayYuen666/dsh-plugin-shared](https://github.com/JayYuen666/dsh-plugin-shared). `LICENSE` ships with the package.
