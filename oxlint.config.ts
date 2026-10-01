import { definePluginConfig } from "./config/oxlint.base.ts";

export default definePluginConfig({
  // 无包内例外：基线（只读那一组同步 API）已覆盖本包的全部用法。
  titlePrefixes: ["Buffer", "CSRF", "IPv4", "NaN", "PTC"],
});
