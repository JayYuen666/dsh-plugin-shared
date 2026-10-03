# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.1

### Changed

- **Removed `resultIsError`.** It had no consumer: the sibling packages fold tool results through `toolEventRowsOf` / `scanToolEvents`, and `resultRecordOf` reads the success bit directly. Its three tests now go through `toolEventRowsOf`, so the behaviour they pin (message-level `isError`, the retired block-level shape staying a fail-open fingerprint) is still covered.
- `CROSS_ORIGIN_TEXT` is now exported from `./lib/http`. The browser leg of the trust gate wrote its own copy of the same sentence; two literals for one rejection means one of them eventually drifts.
- `scanToolEvents` iterates with `entries()`, and the explicit `event !== undefined` guard is gone: `isRecord` already returns `false` for `undefined` and `null`, so the guard was redundant at runtime and only looked necessary because indexing produced a `| undefined` type.
- `canonicalizeRegionPaths` folds region markers with a single `replace` instead of `split`/`map`/`join`, which no longer builds two intermediate arrays over the whole bundle. `canonicalizeLine` lost its `startsWith` check because the regex already anchors on the line start.
- **`errorText` now returns more text; its name and signature are unchanged.** It went from a single `message` layer to the semantics of the official `@deepseek-ai/dsh-llm` `errorChain`: a cause chain renders as `outer: inner`, an `AggregateError` appends `[e1; e2]`, an empty message falls back to `Error.name`, a cross-realm `Error` yields its own `message` rather than `String()`'s `"Error: ..."`, and a hostile getter or `toString` degrades to a placeholder instead of throwing out. Callers that regex the old text must re-check. The implementation stays local and dependency-free: the official symbol is exported from the `@deepseek-ai/dsh-llm` root, and bundling that root for a browser entry produces 160,105 bytes even with `moduleSideEffects: false` while leaving an unresolvable `node:module` in the artifact. The official client packages themselves never value-import that package.
- `editPathOf` returns a `kind`-discriminated `EditTarget` holding only `write` and `read-view`. `"skip"` was declared but never produced; it only pushed consumers into writing unreachable branches. When no path can be read the matching arm is still returned with `path` set to `undefined`.
- `isCrossOrigin`, `queryParam`, `checkCsrf`, `requestTrust` and `guardTrust` widened their first parameter from `IncomingMessage` to `HttpRequest`, so the partial-request shape the header helpers were written for is now actually usable by callers. `readBody` and `guardBody` still take `IncomingMessage`: they consume the request body and `PartialRequest` does not guarantee async iteration.
- Every field of `ToolCallRecord`, `ToolResultRecord` and `ToolEventRows` is now `readonly`, matching the rest of the package's exported interfaces — a ledger that can be edited in place is no longer evidence.

### Not changed, deliberately

- `callRecordOf` / `resultRecordOf` keep their `let record` + single trailing return. Rewriting them into direct returns is *not* a simplification here: this package runs oxlint with `consistent-return` plus `treatUndefinedAsUnspecified`, which rejects mixing `return undefined` with value returns. The shape exists to satisfy that rule, not for style.
- `parseToolArguments` and `toolArgumentsBad` stay exported. They have no consumer today, but a consumer that folds the ledger itself (`toolEventRowsOf` users) must re-read the arguments fields; without them it would reimplement exactly the field reads this package exists to keep single-sourced.
- The release line stays `0.1.x`: this ships as 0.1.1 rather than 0.2.0. Removing `resultIsError` and changing `editPathOf`'s return shape would normally ask for 0.2.0, but every sibling package pins `^0.1.0`, which under `0.x` resolves to `>=0.1.0 <0.2.0` — cutting 0.2.0 means nine dependency-range bumps have to land in the same release. Staying on 0.1.x avoids that coupling, at the price of these breaking changes arriving through a patch bump; the failure face is a typecheck error on the call site, not a runtime surprise.

### Fixed

- `deriveProjectKey`'s `sep` option selects the **whole** path-semantics arm now; `resolve` follows it instead of staying platform-native. The two were split, so on a Windows runner the POSIX arms folded separators with `/` while `path.resolve` handed back a `D:`-prefixed string: the pinned key literals drifted and one case named a bucket after the entire resolved path (`D:\a\my\proj-…`). Default behaviour is byte-identical on both platforms — POSIX resolves through `path.posix`, Windows through `path.win32`, which is what the platform module is anyway — so no existing bucket moves. Each case now declares which arm it judges, and the realpath stand-in that stripped the cwd prefix `path.resolve` had added (needed only because the arms were split) is gone.
- `sendJson` now serializes before writing headers. Previously a payload `JSON.stringify` rejected on (a circular reference, a `BigInt`) threw *after* `writeHead`, leaving the response open with headers already sent and `end()` never called: the client waited until timeout and the caller could no longer change the status code. The failure is now an ordinary synchronous throw with the response still writable.
- `settleLessonCall` treats function-thenables as awaitable. Missing them left a rejection with no handler, which surfaces as a process-level unhandled rejection — the one failure direction that is unsafe.
- `settleLessonCall` contains a throwing `onFailure` on both failure faces. It previously forked: the synchronous path threw at the caller, the asynchronous path became an unhandled rejection. Both now log and swallow, so the original failure is not masked.
- The trust module no longer cites a stale line number for the official `isTrustedApiRequest`. The cited coordinates pointed at unrelated code; the comment now names the module and symbol and explains the three reasons it cannot be imported (client package, `trustedHosts` is a private field, and the published tarball has no `src/`).

### Added

- `test/publish-manifest.test.ts` now scans the source plane as well as the artifact plane for dates and round-relative wording. The artifact pass cannot see comments, so a cleanup confined to it would be a one-off with no regression protection. Sibling-package identifiers stay forbidden in artifacts only — listing which cards already use a helper is useful documentation.
- `EditTarget`: the discriminated return type of `editPathOf`.

- `test/publish-manifest.test.ts`: a release-shape gate. Every `exports` target must be inside what `files` ships, entries must point at build output rather than source, `publishConfig` must not carry entry fields, and shipped artifacts must not contain absolute paths, home-directory references, dates or sibling-package identifiers.
- `.github/workflows/ci.yml`: the quality gate on push and pull request, across a Node version matrix and on Windows, plus a clean-directory install matrix that packs, installs with no flags, imports every subpath and type-checks a consumer probe.
- `build-clean.mjs`, wired as `prebuild`, deletes `dist/` before each build so a renamed facet cannot keep publishing its orphan artifact.
- `engines.node`, `sideEffects`, `homepage`, `bugs`, `keywords`.
- `CHANGELOG.md` and `README.zh.md`.
- `lib/job-outcome` re-exports the official `JobOutcome` type so consumers can name it without restating its structure.
- `readBody` rejects a budget that is not a finite non-negative number with the new `BodyRead` reason `bad-budget`; `guardBody` answers it with HTTP 500 instead of blaming the client.
- `deriveProjectKey` normalizes Windows path separators and routes a drive root to `default`. Both spellings of one Windows directory now share a bucket.
- `resolveSonarjsEntry`: the sonarjs JS-plugin entry is resolved lazily and fails with an actionable message instead of at import time.

### Changed

- **Breaking (published form):** `main` and `exports` now point at `dist/` only, and `publishConfig` keeps just `access`/`registry`. Previously the entry overrides lived in `publishConfig`, which pnpm merges onto the top level when publishing and npm does not — publishing with npm shipped a package whose fourteen entry points named files absent from the tarball.
- **Breaking (compat):** `BodyRead["reason"]` gained a third member, so consumers switching over it exhaustively get a compile error.
- **Breaking (Windows data):** bucket keys for Windows paths change shape; keys written before this release no longer match. POSIX keys are byte-for-byte unchanged.
- **Breaking (type surface):** `Locale` is now an alias of the official `BuiltInLocaleId` rather than a hand-written `"zh" | "en"` union.
- `eslint-plugin-sonarjs`, `oxlint` and `vitest` are no longer `peerDependencies`. npm 7+ tries to satisfy optional peers too, and `oxlint`'s `peerOptional vite-plus` pins `vitest` to a version disjoint from `>=5.0.2`, which made a plain `npm install` of this package fail with `ERESOLVE`. The requirement moved to the README's `config/` section.
- The six official packages referenced only by published declarations are now declared as dependencies: an undeclared type import does not fail loudly, it silently degrades public types to `any` (and resolves to nothing at all under pnpm's isolated layout).
- The `./config/*` passthrough in `exports` is replaced by explicit entries, so no arbitrary file under `config/` is reachable as a subpath.
- `files` no longer ships the raw `config/*.ts` sources; unpacked size drops accordingly.

### Fixed

- `deriveProjectKey` on a Windows-shaped path used to return the entire path as the trailing segment, because the tail was cut at `/` only.
- `readBody` treated a `NaN` or `Infinity` budget as no limit at all, since every comparison with `NaN` is false — the memory bound the module exists to provide was silently disabled.
- Importing `@jayyuen66/dsh-plugin-shared/config/oxlint` failed at module load when `eslint-plugin-sonarjs` was absent, despite the package being declared optional.

### Removed

- `peerDependencies` entries for the three toolchain packages, and the `./config/*` wildcard subpath.
