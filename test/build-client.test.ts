import { describe, expect, it } from "vitest";
import { buildClient } from "../build-client.mjs";

const CLIENT_SURFACE = [
  "CARD_UI_CSS",
  "CardForm",
  "Field",
  "FieldGrid",
  "FieldLabel",
  "InfoTip",
  "ListField",
  "NumberField",
  "SaveBar",
  "Section",
  "SelectField",
  "StatusBar",
  "TextField",
  "ToggleField",
  "splitHint",
  "diffTouched",
  "claimApply",
  "fieldOf",
  "isRecord",
  "errorText",
];

describe("shared 客户端行", () => {
  it("入口自己导出 Cordis 插件面与全部客户端具名", async () => {
    const mod = (await import("../lib/client-entry.ts")) as Record<string, unknown>;
    expect(mod["name"]).toBe("@jayyuen66/dsh-plugin-shared");
    expect(mod["apply"]).toBeTypeOf("function");
    const missing = CLIENT_SURFACE.filter((name) => mod[name] === undefined);
    expect(missing).toStrictEqual([]);
  });

  it("两个入口的 apply 都能被 Cordis 直接调用", async () => {
    const plugin = (await import("../lib/plugin.ts")) as Record<string, unknown>;
    const client = (await import("../lib/client-entry.ts")) as Record<string, unknown>;
    expect(() => {
      (plugin["apply"] as () => void)();
    }).not.toThrow();
    expect(() => {
      (client["apply"] as () => void)();
    }).not.toThrow();
  });

  it("产物是宿主模块图的 UMD 行，id 与包名一致", async () => {
    const out = await buildClient();
    expect(out).toContain("__ModuleLoader__.load");
    expect(out).toContain('"@jayyuen66/dsh-plugin-shared"');
    expect(out).toMatch(/exports\.apply\s*=/u);
    const absent = ["CARD_UI_CSS", "diffTouched", "claimApply", "isRecord", "errorText"].filter(
      (name) => !out.includes(name),
    );
    expect(absent).toStrictEqual([]);
  });
});
