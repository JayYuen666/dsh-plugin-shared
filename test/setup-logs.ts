// test/setup-logs.ts —— 插件运行日志的记录清单（vitest setupFile）。
//
// 为什么不用 vitest 的 `silent`：那只是不显示，新出现的日志照样没人看。这里把「跑测不该有
// 操作者日志漏进报告」变成一条可判的约定：
//   ① 每条 `[<pkg>]` 日志必须含有 test/log-templates.ts 里的某个模板片段，否则立即失败；
//   ② 带别家标签的日志出现在本包测试里也失败（装配范围错了）；
//   ③ 生产侧一行不改：级别、文案、时机全部照旧，记录清单只在测试进程里接管输出。
// 用例要看日志内容时用 logged()/loggedText() 取，断言写在用例里。
//
// 本包与兄弟包（danger-guard / quality-gate / lesson-loop / session-rescue /
// dir-prep-organize）共用这一份形状。本包的标签**带模块后缀**（`[shared/lesson-bus]`），
// 所以认领判断必须允许「包名之后直接是 `/` 或收尾 `]`」这两种继续，而不是写死整串标签。
import { afterEach, beforeEach } from "vitest";
import assert from "node:assert/strict";

import { LOG_TEMPLATES } from "./log-templates.ts";

/**
 * 本包标签的判断：`[shared]`、`[shared/lesson-bus]` 都算本包，`[shared-utils]` 不算。
 *
 * 不用 `startsWith("[shared")`：那个前缀会把 `[shared-utils]` 这类别家标签一起认成本包，
 * 于是真正的「装配范围错了」被放过，而未认领判断又对着别人的日志报错。
 */
const PKG_PREFIX = /^\[shared(?:[/\]]|$)/u;

/** 插件会用到的 console 级别（联合类型取属性，避免以字符串索引 Console）。 */
export type LogLevel = "info" | "warn" | "error" | "log" | "debug" | "trace";
const LEVELS: readonly LogLevel[] = ["info", "warn", "error", "log", "debug", "trace"];

/** 一次接管到的调用：拼平的首参 + 拼平的全部实参 + 其余实参（堆栈通常就藏在其余实参里）。 */
export interface LogRecord {
  level: LogLevel;
  /** 只由首参拼成，供 `logged()` 与用例的正文断言使用。 */
  text: string;
  /**
   * 全部实参拼平后的正文。模板认领要读这一份：源码里有不少日志把文案拆成两个实参
   * （`console.error("[shared/x] 失败:", cause)`），只比首参会把合法日志判成未认领。
   */
  full: string;
  extra: unknown[];
}

/** 本条用例接管到的日志：数组身份常驻（每条用例清空而不是换一份，
 *  换引用会让 `logged()` 读到旧数组——原来是模块级 `let`，被 require-hook 判成裸赋值）。 */
const records: LogRecord[] = [];
const originals = new Map<LogLevel, (...args: unknown[]) => void>();

/** 接管一个级别：处理器单独成函数，别在 for 里现造闭包（no-loop-func 拦的就是这个）。 */
function spyLevel(level: LogLevel): void {
  originals.set(level, console[level]);
  console[level] = (...args: unknown[]) => {
    const [first, ...rest] = args;
    records.push({
      level,
      text: String(first).replaceAll(/\s+/gu, " "),
      full: args.map(String).join(" ").replaceAll(/\s+/gu, " "),
      extra: rest,
    });
  };
}

function install(): void {
  // 幂等：重复 install 会把**上次的 spy** 当成原始实现存进 originals，uninstall 之后
  // console 上留下的仍是 spy，后续用例的日志就再也进不了记录清单。这里先就地还原一遍。
  for (const [level, fn] of originals) {
    console[level] = fn;
  }
  originals.clear();
  for (const level of LEVELS) {
    spyLevel(level);
  }
}

function uninstall(): void {
  for (const [level, fn] of originals) {
    console[level] = fn;
  }

  originals.clear();
}

function containsTemplate(record: LogRecord): boolean {
  return LOG_TEMPLATES.some((fragment) => record.full.includes(fragment));
}

beforeEach(() => {
  records.length = 0;
  install();
});

afterEach(() => {
  uninstall();
  const ours = records.filter((record) => PKG_PREFIX.test(record.text));
  const strangers = records
    .filter((record) => record.text.startsWith("["))
    .filter((record) => !PKG_PREFIX.test(record.text))
    .map((record) => record.text.slice(0, 120));
  const unclaimed = ours
    .filter((record) => !containsTemplate(record))
    .map((record) => record.text.slice(0, 120));

  assert.deepEqual(strangers, [], "本包测试里出现了别家插件的日志：装配范围错了");
  assert.deepEqual(
    unclaimed,
    [],
    "这些日志对不上本包源码里的任何模板片段：新增 console.* 没有用例认领，或消息是临时拼的",
  );
  // 收尾清一次：本用例里起的异步任务可能在 afterEach 之后才落日志，那一条若留到下一用例
  // 的断言里，就会被当成下一条用例产生的日志，而真正的出处已无从查起。
  records.length = 0;
});

/** 本条用例产生的插件日志，按调用顺序。 */
export function logged(): readonly LogRecord[] {
  return records.filter((record) => PKG_PREFIX.test(record.text));
}

/** 拼平的日志正文，便于 match 断言。 */
export function loggedText(): string {
  return logged()
    .map((record) => record.text)
    .join("\n");
}
