// lib/text.ts —— 代理对安全的定长截断。前切面已交官方件，后切面仍是本仓自带。
//
// 为什么存在：宿主把工具结果持久化进会话日志，切点若落在代理对中间，产出的孤立
// 高代理在 UTF-8 编码时变 U+FFFD，或使后续 Messages 请求整体失败（上游同一缺陷即
// 触发这次收口）。凡是"切完还会进会话日志"的自制切点一律收口到这里。
//
// 消费方清单（按本模块找调用点请以这份为准；改调用点要同步这里）：
//   - ocr-review/host.ts —— `failureDetail` 的头尾两切、`runCollect` 的 output 一切、
//     `echoRaw` 一切（该函数有 5 个入日志调用点）；
//   - zvec-grep/host.ts —— `failureDetail` 的头尾两切、`successNotes` 的 stderr 尾切
//     （成功结果也入日志），以及 rebuild-status 投影的 4000 码元尾窗（后来也从这里切：
//     官方环按 UTF-8 字节裁，那一刀用裸 slice 会在切点留下孤立低代理项，故不留第三份实现）。
// 只剩一类切点不在其列：**永不显示给用户也永不入日志**的中间量。
//
// 为什么只剩一半：官方等价物 truncateWithoutSplittingSurrogatePair 实测在宿主实装的
// 0.2.0-rc.2 里存在、在 0.1.7-alpha.1 里不存在（当时因此只能本仓自制；具体落在
// 区间内哪个版本引入未实测，不宣称）。它是**前切专用**——实测 rc.2 的导出面
// （ItemRetainer/TextRetainer/describeOmitted/formatRetentionNotice/该函数）没有任何
// 后切形态，故 truncateEnd 已改走官方件，truncateStart 仍须本仓自带。
//
// 只处理两端的孤立半代理，不做字素簇/ZWJ 语义（那是显示层的事，本模块明确不做）。
//
// 零预算与 NaN 预算两端同口径：都返回空串。truncateStart 必须自己判 `!(minChars > 0)`
// —— 否则 `slice(-0)` 即 `slice(0)`，整串原样吐回，正是本模块要拦住的超长输出；
// 写成"取反的正判"而不是 `minChars <= 0`，是因为 NaN 与两者比较都是 false，
// 裸 `<=` 会让 truncateStart(x, NaN) 吐整串而 truncateEnd(x, NaN) 给空串。truncateEnd
// 一侧由 Math.max(0, ·) 与官方件合力达成：官方把负预算交给 slice(0, 负数) 解释成
// "从尾部倒数"，钳零之后与本地旧实现同口径；NaN 经 Math.max 仍是 NaN，官方拿它走
// slice(0, NaN) 得空串。本模块不写 `if (cut.length === 0) return cut;` 这类空切点早
// 返回：truncateStart 一侧它被上面的早返回挡成真·死臂（本包 vitest 四阈值 100 容不下
// 测不到的分支），truncateEnd 一侧换装后连 `cut` 都不再有，写它就没有落点。

import { truncateWithoutSplittingSurrogatePair } from "@deepseek-ai/dsh-output-retention";

// 两枚边界即 UTF-16 低代理区下界 0xDC00 与上界 0xDFFF；高代理区那一半的判定已随
// 前切面一起交给官方件。写成十进制而不是十六进制字面量：oxfmt 会把 hex 数字小写，
// 而 oxlint 的 unicorn/number-literal-case 要它大写，两条 gate 在 hex 上互斥（实测）。
const LOW_SURROGATE_START = 56_320;
const LOW_SURROGATE_END = 57_343;

/**
 * 保留前 `maxChars` 个码元；切点切开代理对时丢掉尾部那个孤立高代理。
 * `maxChars <= 0` 与 NaN ⇒ 空串。
 */
export function truncateEnd(text: string, maxChars: number): string {
  // 钳零不是保险：官方把负预算交给 slice(0, 负数) 解释成"从尾部倒数"，详见文件头。
  return truncateWithoutSplittingSurrogatePair(text, Math.max(0, maxChars));
}

/**
 * 保留后 `minChars` 个码元；切点切开代理对时丢掉首部那个孤立低代理。
 * `minChars <= 0` 与 NaN 与 `truncateEnd(text, 0)` 同口径返回空串，不返回整串。
 */
export function truncateStart(text: string, minChars: number): string {
  // NaN 走不进 `<= 0`，却会走进 `slice(-NaN)`＝`slice(0)`＝整串 ⇒ 两种"预算不可用"都点名判，
  // 而不是写成 `!(minChars > 0)`（那条等价但把意图藏进了取反，也被 sonarjs/no-inverted-boolean-check
  // 判成该翻成 `<=` —— 直接翻会漏掉 NaN，所以这里是把两臂写全，不是把判据放宽）。
  if (minChars <= 0 || Number.isNaN(minChars)) {
    return "";
  }
  if (text.length <= minChars) {
    return text;
  }
  const cut = text.slice(-minChars);
  // 与 truncateEnd 同理：判的是切点那一枚，首枚若是被切下来的孤低代理就丢掉。
  const first = cut.codePointAt(0);
  return first !== undefined && first >= LOW_SURROGATE_START && first <= LOW_SURROGATE_END
    ? cut.slice(1)
    : cut;
}
