// build-shared.mjs 的声明（供 test/build-shared.test.ts 侧类型化导入）。
// 只声明测试直接消费的两个面；构建脚本共用同一份实现。

/** 调用方 `import.meta` 的最小形状：`main` 在非 Node 的 ESM 转换环境里可能缺失。 */
export interface ImportMetaLike {
  readonly url: string;
  readonly main?: boolean;
}

/** 调用方 `import.meta` 是否为直接入口；原生值优先，缺失时回退到 argv/realpath 比较。 */
export function isMainModule(meta: ImportMetaLike): boolean;

/** 造 rolldown external 判定函数：dependencies + peerDependencies + extraNames 的包名段。 */
export function createIsExternal(
  root: string,
  extraNames?: readonly string[],
): Promise<(id: string) => boolean>;
