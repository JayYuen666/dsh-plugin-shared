import { definePluginConfig } from "./config/oxlint.base.ts";

export default definePluginConfig({
  // 包内例外只有一个：`execFileSync` —— 规则快照检查（test/config-oxlint.test.ts）要启动
  // `oxlint --rules` 子进程，取 vitest 规则全集的实际输出。为什么用同步：这条检查没有并发需求，
  // 而 async 三种写法恰好都被基线三条 promise 规则禁止——`new Promise`（promise/avoid-new）、
  // 回调形（promise/prefer-await-to-callbacks）、`promisify(execFile)`
  // （typescript/strict-void-return：execFile 返回 ChildProcess，promisify 的签名要的是
  // 返回 void 的回调式函数）。基线的只读组（existsSync/readFileSync/...）不含它，
  // 故按「逐项登记」的方式登记这一个（danger-guard 的产物加载检查做了同样的取舍）。
  syncWrites: ["execFileSync"],
  // 唯一一条包内例外，范围收到单个用例文件。
  // `unicorn/no-thenable` 禁的是「把 thenable 当公开 API 自造」。而 lesson-bus 的被测对象
  // 恰恰是 `isThenable` 对各种形状的判定，其中一支是**函数型** thenable：不造出这个形状，
  // 那条分支就测不到，而漏判的方向是不安全的——无人接住的 rejection 会变成进程级未处理拒绝。
  // 判断在这里的前提不成立，所以按文件收窄关闭，而不是为了通过 lint 把测试改成绕开判断。
  extraOverrides: [
    {
      files: ["test/lesson-bus.test.ts"],
      rules: { "unicorn/no-thenable": "off" },
    },
    {
      // card-ui 用 createElement 写 JSX-free 组件：单字符 SVG 属性键、嵌套元素与
      // 长组件函数是这套写法的固有形状，逐条改写只会把结构拆碎。
      files: ["lib/card-ui/*.ts"],
      rules: {
        "eslint/id-length": "off",
        "eslint/max-lines-per-function": "off",
        "unicorn/max-nested-calls": "off",
        "sonarjs/cognitive-complexity": "off",
      },
    },
    {
      // 用例里反复出现的字段名与文案是测试数据，不是可复用常量。
      files: ["test/card-ui.test.ts"],
      rules: {
        "eslint/id-length": "off",
        "eslint/max-lines-per-function": "off",
        "unicorn/max-nested-calls": "off",
        "sonarjs/no-duplicate-string": "off",
      },
    },
  ],
  offReasons: {
    "unicorn/no-thenable": {
      kind: "仅限特定文件",
      measured: 2,
      note: "被测对象就是 thenable 判定本身；只有这一个用例文件需要造出函数型 thenable 形状",
    },
    "eslint/id-length": {
      kind: "仅限特定文件",
      measured: 5,
      note: "card-ui 与它的用例使用 SVG 单字符属性键与短测试数据名；文件级收窄",
    },
    "eslint/max-lines-per-function": {
      kind: "仅限特定文件",
      measured: 2,
      note: "createElement 组件与它的 describe 块按结构分组；文件级收窄",
    },
    "unicorn/max-nested-calls": {
      kind: "仅限特定文件",
      measured: 7,
      note: "JSX-free 的 createElement 天然多层嵌套；文件级收窄",
    },
    "sonarjs/cognitive-complexity": {
      kind: "仅限特定文件",
      measured: 1,
      note: "下拉的键盘分派集中在一处；文件级收窄",
    },
    "sonarjs/no-duplicate-string": {
      kind: "仅限特定文件",
      measured: 5,
      note: "用例里的字段名与文案是测试数据；文件级收窄",
    },
  },
  // 只登记真正会出现在标题开头的技术名。每登记一条就多一片免检范围（命中前缀即整条标题免检），
  // 所以陈旧的条目必须删掉：IPv4 在本仓用例标题里已经一处都没有了。
  titlePrefixes: [
    "Buffer",
    "CSRF",
    "Field",
    "Home",
    "InfoTip",
    "ListField",
    "NaN",
    "NumberField",
    "PTC",
    "POSIX",
    "SaveBar",
    "SelectField",
    "TextField",
    "ToggleField",
    "Windows",
    "Win32",
  ],
});
