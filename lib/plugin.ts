export * from "./index.ts";

export const name = "@jayyuen66/dsh-plugin-shared";

/** 宿主侧没有要注册的服务；这个入口只让 Loader 能把本包当作一个插件行加载。 */
export function apply(): void {
  void 0;
}
