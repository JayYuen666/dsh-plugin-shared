import { describe, expect, it } from "vitest";

import { clampInt, isRecord, markRemote, scanToolEvents, truncateCodePoints } from "../lib/tool.ts";
import {
  isRecord as browserIsRecord,
  truncateCodePoints as browserTruncateCodePoints,
} from "../lib/tool-browser.ts";

describe("工具侧单一入口", () => {
  it("node 入口聚合 20 个工具模块", () => {
    expect(clampInt(9, 0, 3, 0)).toBe(3);
    expect(truncateCodePoints("😀x", 1)).toBe("😀");
    expect(isRecord({})).toBe(true);
    expect(markRemote).toBeTypeOf("function");
    expect(scanToolEvents).toBeTypeOf("function");
  });

  it("browser 条件只暴露纯件", () => {
    expect(browserIsRecord({})).toBe(true);
    expect(browserTruncateCodePoints("ab", 1)).toBe("a");
  });
});
