import { definePluginConfig } from "./config/oxlint.base.ts";

export default definePluginConfig({
  // 包内例外只有一枚：`execFileSync` —— 规则快照门禁（test/config-oxlint.test.ts）要起
  // `oxlint --rules` 子进程拿 vitest 规则全集的现量。为什么是同步：这条门禁没有并发需求，
  // 而 async 三种写法恰好被基线三条 promise 规则夹死——`new Promise`（promise/avoid-new）、
  // 回调形（promise/prefer-await-to-callbacks）、`promisify(execFile)`
  // （typescript/strict-void-return：execFile 返回 ChildProcess，promisify 的签名要的是
  // 返回 void 的回调式函数）。基线的只读组（existsSync/readFileSync/...）不含它，
  // 故按「逐项登记」的口径登记这一枚（danger-guard 的产物加载门禁同款取舍）。
  syncWrites: ["execFileSync"],
  // 唯一一条包内例外，范围收到单个用例文件。
  // `unicorn/no-thenable` 禁的是「把 thenable 当公开 API 自造」。而 lesson-bus 的被测对象
  // 恰恰是 `isThenable` 对各种形状的判定，其中一支是**函数型** thenable：不造出这个形状，
  // 那条分支就测不到，而漏判的方向是不安全的——无人接住的 rejection 会变成进程级未处理拒绝。
  // 判据在这里的前提不成立，所以按文件收窄关闭，而不是为了过 lint 把测试改成绕开判据。
  extraOverrides: [
    {
      files: ["test/lesson-bus.test.ts"],
      rules: { "unicorn/no-thenable": "off" },
    },
  ],
  offReasons: {
    "unicorn/no-thenable": {
      kind: "文体作用域",
      measured: 2,
      note: "被测对象就是 thenable 判定本身；只有这一个用例文件需要造出函数型 thenable 形状",
    },
  },
  // 只登记真正会出现在标题开头的技术名。每条都多一片免检面（命中前缀即整条标题免检），
  // 所以陈旧的条目必须删掉：IPv4 在本仓用例标题里已经一处都没有了。
  titlePrefixes: ["Buffer", "CSRF", "NaN", "PTC", "POSIX", "Windows", "Win32"],
});
