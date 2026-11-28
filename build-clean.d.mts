// build-clean.mjs 的声明（供 test/build-clean.test.ts 侧类型化导入）。
/** 清空目录；目录不存在视为成功。非 ENOENT 错误会抛出。 */
export function cleanDist(dir: string): Promise<void>;

/** CLI 的报告选项：注入 clean/log 便于测试失败分支，不改变脚本行为。 */
export interface CleanRunOptions {
  clean?: (dir: string) => Promise<void>;
  log?: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/** 执行清理并按结果返回退出码；失败只报告一次。 */
export function runClean(options?: CleanRunOptions): Promise<0 | 1>;
