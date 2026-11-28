// lib/cli-safety.ts —— 拼进 shell 命令的用户可控字符串的唯一转义处。
//
// 为什么值得单点定义：ocr-review 与 zvec-grep 各写了一份 `shq`，但两份各带一半保证：
//   - ocr 版只做 POSIX 单引号，**函数内拒 NUL**；
//   - zvec 版同时支持 POSIX 与 PowerShell 单引号，**不拒 NUL**，靠上游 `optionalText`/
//     `stringList` 先挡。
// 合并时不能二选一：NUL 检查必须进实现（「转义后的串一定能被 shell 完整读回」是函数
// 自己的保证，不是调用顺序的隐式前提）；平台参数保留 zvec 的 pwsh 写法，调用方按
// `runtimePlatform()` 传入，POSIX 调用点用缺省值即可。
//
// 单引号内容在两种 shell 里都不做变量展开，`$`、反引号、反斜杠都按字面量保留；差别只在
// 内嵌单引号的写法：POSIX `'\''`，PowerShell `''`。

/** shell 方言：posix = bash/sh，win32 = pwsh。 */
export type ShellPlatform = "posix" | "win32";

/**
 * 把任意字符串安全放进单引号内。
 *
 * NUL 一律拒绝：POSIX 命令串根本无法表示 NUL 字节，含 NUL 的值经 `bash -c '<inner>'`
 * 会被截断或报错，产出「看起来成功但 argv 被截断」的不确定行为。
 * @param value - 待转义的原文
 * @param platform - shell 方言（缺省 posix）
 * @returns 可直接拼进命令的单引号串
 */
export function shq(value: string, platform: ShellPlatform = "posix"): string {
  if (value.includes("\u0000")) {
    throw new Error("shq: value contains a NUL byte; the shell cannot read it back");
  }
  return platform === "win32"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
