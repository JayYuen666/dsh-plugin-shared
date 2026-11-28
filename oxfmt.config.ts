// 本包对共享 oxfmt 基线的唯一差异：Markdown 与带注释的 JSON 由写作者排版，不进格式化。
// 手写完整对象而不是 extends：oxfmt 的 TS 配置没有合并语义，基线演进来需人工跟。
export default {
  ignorePatterns: ["**/*.md", "**/*.jsonc"],
};
