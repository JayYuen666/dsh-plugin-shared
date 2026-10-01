// lib/project-key.ts —— cwd → 项目桶键的**单一来源**。
//
// 为什么存在：同一个"这次教训属于哪个项目"的判定此前有两份逐字节重复的实现
// （lesson-loop lib/lesson-store.ts deriveProject 与 quality-gate lib/gateway-feedback.ts
// deriveAgentId）。键是持久化数据与跨系统对照的桶名，双份实现意味着改一处漏一处——
// 收敛到这里，两侧各留一个薄别名。
//
// 跨系统契约（不可动）：记忆网关 plugin/lib/workspace-peer.ts 的 deriveAgentId 产出
// `尾目录名-<sha256(norm) 前 8 位 hex>`。本模块**不改**哈希算法、8 位切片与尾段空白
// 清洗（动一位就等于把存量教训/记忆从原桶里搬走）；只在归一阶段补两处真实缺陷：
//   1. path.resolve —— 相对路径与 `./`、`../` 冗余段不再各成一桶；
//   2. realpath —— 软链（macOS `/tmp` ↔ `/private/tmp`）指向同一目录时归一到同一桶。
// 不变式：输入已是"绝对且规范"的路径时，resolve 与 realpath 都是恒等变换，产出的键
// 与旧实现逐字节相同（test/project-key.test.ts 以字面量钉住），故存量桶不迁移。
// realpath 失败（ENOENT：目录尚未创建；EACCES：无权限）时退回 resolve 结果继续——
// 桶键是纯字符串派生，不能让文件系统状态把上报/守卫热路径抛断。

import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/** 可注入面：realpath 是同步 fs 调用，测试替换它来观察软链归一与失败兜底两条臂。 */
export interface ProjectKeyOptions {
  realpath?: (target: string) => string;
}

/**
 * cwd → 项目桶键。非字符串 / trim 后为空 / 归一后落到根目录 → `"default"`
 * （与记忆网关的兜底桶名一致）。
 */
export function deriveProjectKey(cwd: unknown, opts?: ProjectKeyOptions): string {
  if (typeof cwd !== "string") {
    return "default";
  }
  const trimmed = cwd.trim();
  if (trimmed === "") {
    return "default";
  }
  // 引用而非调用 realpathSync 作默认值：node/no-sync 只放行显式注入的同步 fs 面。
  const realpath = opts?.realpath ?? realpathSync;
  let resolved = path.resolve(trimmed);
  try {
    resolved = realpath(resolved);
  } catch {
    /* 文件系统状态不参与键计算：保留 resolve 结果 */
  }
  // 归一后必是绝对路径（resolve 保证），根目录经去尾斜杠退化为空串 → default。
  const norm = resolved.replaceAll(/\/{2,}/gu, "/").replace(/\/+$/u, "");
  if (norm === "") {
    return "default";
  }
  // norm 已去过重斜杠与尾斜杠且非空 → 尾段必非空（无需"空尾段"兜底分支）。
  const last = norm.slice(norm.lastIndexOf("/") + 1);
  const safe = last.replaceAll(/\s+/gu, "_");
  const hash = createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 8);
  return `${safe}-${hash}`;
}
