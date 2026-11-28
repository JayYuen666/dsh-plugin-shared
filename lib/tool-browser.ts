// lib/tool-browser.ts —— `./tool` 的浏览器条件实现。
//
// 为什么需要第二条产物：`lib/tool.ts` 是工具侧全集，含 `project-key` / `path-scope` 等
// 值导入 `node:fs` / `node:crypto` / `node:path` 的模块。双用源（如 dir-prep 的
// `src/templates.ts`）同时被 host 与 client 编译，若按 Node 产物解析，客户端 bundle 会把
// 这些 Node 内置模块一起拖进去并报 UNRESOLVED_IMPORT。
//
// 这条 barrel 只收**浏览器可执行**的纯件；`package.json` 的 `./tool` 用 `browser` 条件
// 指向它，Node / host 构建仍解析 `dist/tool.js`。客户端 UI 仍应优先走 `./client`。
export { arrayOf, fieldOf, hasMethods, hasOptionalMethods, isRecord } from "./record.ts";
export { truncateCodePoints } from "./code-points.ts";
export { asDisplayText, asText, escapeRegExp } from "./value.ts";
export { clampInt, versionAtLeast } from "./number.ts";
export { errorText, isEnoent, isErrnoCode, isSettingsConflict } from "./errors.ts";
export { isThenable, settleLessonCall } from "./lesson-bus.ts";
export { isDisposer, isProjectionHandle } from "./session-projection.ts";
export { shq } from "./cli-safety.ts";
export { fillPlaceholders } from "./placeholder.ts";
export {
  DEFAULT_LOCALE,
  LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  messagesFor,
  resolveLocale,
  resolveLocalePreference,
} from "./locale.ts";
export { raceTimeout } from "./with-timeout.ts";
