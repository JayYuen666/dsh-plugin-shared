// build-host.mjs 的声明（供 test/build-host.test.ts 侧类型化导入）。
// 与兄弟包不同：本包的 buildHost() 返回「落盘绝对路径 → 文件文本」的 Map，
// 由 main() 统一写盘（多入口 + code-split，chunk 名带 hash 故不能在类型里写死文件名）。
export function buildHost(): Promise<Map<string, string>>;
