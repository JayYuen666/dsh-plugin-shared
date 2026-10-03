import { definePluginConfig } from "./config/oxlint.base.ts";

export default definePluginConfig({
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
  titlePrefixes: ["Buffer", "CSRF", "IPv4", "NaN", "PTC", "POSIX", "Windows", "Win32"],
});
