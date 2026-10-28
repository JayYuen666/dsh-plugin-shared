// test/log-templates.test.ts —— 记录清单的反向校验：登记的片段必须还在源码里，源码里的
// console.* 也必须被某个片段认领。
//
// 为什么需要它：正向判断（test/setup-logs.ts 的「未认领」断言）只在**多**的时候响——
// 新增日志忘了登记会判失败。反过来，源码里删掉一条日志后留下的陈旧片段没有任何东西会失败，
// 而陈旧片段会继续把别的日志「认领」掉，等于把那条检查悄悄放宽。
//
// 扫描范围只有 lib/：build-*.mjs 的 console 是构建脚本的输出，不进插件记录清单。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOG_TEMPLATES } from "./log-templates.ts";

const pkgDir = path.join(import.meta.dirname, "..");

/** console.* 调用的首参字符串字面量。本包日志一律写成字面量首参，模板才认领得到。 */
const CONSOLE_CALL = /console\.(?:info|warn|error|log|debug)\(\s*"(?<first>[^"]*)"/gu;

/**
 * lib/ 下全部源文件的正文。
 * @returns 每份文件的文本
 */
async function libSources(): Promise<string[]> {
  const dir = path.join(pkgDir, "lib");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.join(dir, entry.name));
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

/**
 * 源码里所有 console.* 调用的首参字面量。
 * @param texts - 源文件正文
 * @returns 首参清单（按出现顺序）
 */
function loggedFirstArgs(texts: readonly string[]): string[] {
  return texts.flatMap((text) =>
    [...text.matchAll(CONSOLE_CALL)].map((match) => match.groups?.["first"] ?? ""),
  );
}

describe("日志模板记录清单", () => {
  it("登记的每条片段都还在源码的 console 调用里", async () => {
    const logged = loggedFirstArgs(await libSources());
    // 空集不算通过：一条都扫不到时下面那条 some() 恒假，但前一条会很可疑地通过。
    expect(logged.length, "lib/ 下没扫到任何 console 调用").toBeGreaterThan(0);
    for (const fragment of LOG_TEMPLATES) {
      expect(
        logged.some((line) => line.includes(fragment)),
        `陈旧片段（源码里已经没有这条日志了，删掉它）：${fragment}`,
      ).toBe(true);
    }
  });

  it("源码里每条 console 调用的首参都被某个片段认领", async () => {
    const logged = loggedFirstArgs(await libSources());
    for (const line of logged) {
      expect(
        LOG_TEMPLATES.some((fragment) => line.includes(fragment)),
        `未登记的日志首参（往 test/log-templates.ts 补一条）：${line}`,
      ).toBe(true);
    }
  });
});
