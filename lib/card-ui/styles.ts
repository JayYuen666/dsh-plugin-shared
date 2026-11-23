/** 设置卡统一样式。颜色/圆角全部走宿主主题令牌。
 *
 *  v3 视觉层（设计稿 `.tmp-ui-redesign/index-v3.html`）：字段改为「标签行在上、控件在下」的
 *  34px/13px 纵向节律；说明与错误只在 24px 帮助按钮的浮层里，不占第三行；分区 18/12；
 *  按钮 32/13、表格 12px、保存条圆角面板。语义色淡底一律
 *  `color-mix(in srgb, var(--dsw-alias-state-*) N%, transparent)`，与宿主徽章/提示的写法同型，
 *  且避免写死十六进制色（`test/card-ui.test.ts` 有禁色断言）。 */
// 卡片内一律 border-box（见下方 `.dsu-form` 那条规则）。解释写在这里而不是 CSS 注释里：
// 这段模板字符串会原样进产物，CSS 注释也照样占字节，而 `test/dist-size.test.ts` 对
// 运行期切面有总预算。
// 根因：`.dsu-input` 是 `width:100%` + 左右各 12px padding + 1px 边框，浏览器默认
// `content-box` 会把它撑出容器 26px——实测 1280px 视口下右边缘 1258 > 容器 1232，
// 于是 MCP servers 的 textarea、ChatGPT 的输入框一路顶到卡片外的空白里。
// 写在 `.dsu-form` 的子孙上而不是只写 `.dsu-input`：各仓自己的 `.xxx-input` 一并受益；
// `::before`/`::after` 带上，免得伪元素造出的边框还按老尺寸算。
// 保存条规则写成 `.dsu-savebar.dsu-savebar` 是为了压过旧版插件内联的旧一代
// `.dsu-savebar{…background:var(--dsw-alias-bg-base)}`：旧样式由包内另一份
// `CARD_UI_CSS` 注入，覆盖不到「固定 id 已有就跳过」的判据，两份定义会在页面上同时存在。
// 类名重复不是冗余，删掉会把宿主设置对话框里的暗带带回来。它只压得住旧一代的单类选择器；
// 旧样式若写成 `.dsu-form .dsu-savebar`（同特异性）或带 `!important`，仍可能按插入顺序胜出。
// 吸底底色先写一条主题色兜底，再写 `color-mix`：不支持 `color-mix` 的 webview 上至少不会
// 退化成全透明，让滚动内容穿过按钮文字。

// 语义色 token 挂在 body 而不是 .dsu-form：Callout / KpiTile 等展示组件也会被整页直接使用，
// 只挂在表单上时，页面上 warn 圆底与 KPI 涨跌胶囊会全部静默失色。
export const CARD_UI_CSS = `
body{--dsu-ok-text:var(--dsw-static-green-900);--dsu-warn-text:var(--dsw-static-amber-900);--dsu-err-text:var(--dsw-static-red-900);--dsu-ok:var(--dsw-alias-state-success-primary);--dsu-warn:var(--dsw-alias-state-warn-primary);--dsu-err:var(--dsw-alias-state-error-primary);--dsu-tip-surface:var(--dsw-alias-bg-layer-3);--dsu-tip-ink:var(--dsw-alias-label-primary);--dsu-tip-edge:var(--dsw-alias-border-l4)}
body[data-ds-dark-theme]{--dsu-ok-text:var(--dsw-static-green-400);--dsu-warn-text:var(--dsw-static-amber-400);--dsu-err-text:var(--dsw-static-red-100);--dsu-tip-surface:var(--dsw-alias-tooltip-bg);--dsu-tip-ink:var(--dsw-alias-tooltip-label);--dsu-tip-edge:var(--dsw-alias-border-l3)}
.dsu-form{display:flex;flex-direction:column}
.dsu-form,.dsu-form *,.dsu-form *::before,.dsu-form *::after{box-sizing:border-box}
.dsu-section{margin-top:18px;padding-top:12px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsu-form .dsu-section>*+*{margin-top:8px}
.dsu-form .dsu-section>*+.dsu-field{margin-top:0}
.dsu-form .dsu-section>.dsu-savebar{margin-top:24px}
.dsu-form>.dsu-section:first-child{margin-top:0;padding-top:0;border-top:0}
.dsu-sectionTitle{margin:0;font-size:16px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsu-sectionHead{display:flex;align-items:center;gap:8px;min-width:0;margin-bottom:6px}
.dsu-sectionActions{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none}
.dsu-statusbar{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-field{display:flex;flex-direction:column;gap:4px;align-items:stretch;padding:4px 10px;margin:0 -10px;border-radius:var(--dsw-radius-sm,6px);transition:background-color .15s}
.dsu-fieldRow{flex-direction:row;align-items:center;justify-content:space-between;gap:16px}
.dsu-fieldRow .dsu-fieldMeta{flex:1;min-width:0}
.dsu-fieldRow .dsu-control{width:auto;flex:none}
.dsu-field:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-fieldMeta{display:flex;flex-direction:column;gap:2px;min-width:0}
.dsu-labelRow{display:flex;align-items:center;gap:6px;min-width:0;min-height:20px}
.dsu-label{font-size:13px;font-weight:500;line-height:1.3;color:var(--dsw-alias-label-primary)}
.dsu-labelMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dsu-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-srOnly{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.dsu-control{display:block;min-width:0;width:100%}
.dsu-fieldWide{display:flex}
.dsu-fieldWide .dsu-control{width:100%;max-width:none}
.dsu-help{display:inline-flex;align-items:center;gap:6px;min-width:0}
.dsu-helpBtn{appearance:none;border:.5px solid var(--dsw-alias-border-l3);background:transparent;padding:0;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:help;border-radius:50%;flex:none}
.dsu-helpBtnError{border-color:var(--dsu-err);color:var(--dsu-err-text);background:color-mix(in srgb,var(--dsu-err) 10%,transparent)}
.dsu-help:hover .dsu-helpBtn,.dsu-helpBtn:focus-visible{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.dsu-helpBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-tip{width:280px;max-width:min(280px,calc(100vw - 16px));height:max-content;position:fixed;z-index:60;box-sizing:border-box;padding:10px 12px;border-radius:8px;background:var(--dsu-tip-surface);border:.5px solid var(--dsu-tip-edge);box-shadow:var(--dsw-elevation-prominent);font-size:12px;line-height:1.6;font-weight:400;color:var(--dsu-tip-ink);overflow:visible;cursor:default;overflow-wrap:anywhere}
.dsu-tipBody{max-height:min(60vh,320px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.dsu-tip[hidden]{display:none}
.dsu-tip::before,.dsu-tip::after{content:"";position:absolute;width:0;height:0;border-style:solid;border-color:transparent;pointer-events:none}
.dsu-tip[data-side="right"]::before{top:10px;left:-12px;border-width:6px;border-right-color:var(--dsu-tip-edge)}
.dsu-tip[data-side="right"]::after{top:11px;left:-10px;border-width:5px;border-right-color:var(--dsu-tip-surface)}
.dsu-tip[data-side="left"]::before{top:10px;right:-12px;border-width:6px;border-left-color:var(--dsu-tip-edge)}
.dsu-tip[data-side="left"]::after{top:11px;right:-10px;border-width:5px;border-left-color:var(--dsu-tip-surface)}
.dsu-tip[data-side="above"]::before{top:100%;left:50%;transform:translateX(-50%);border-width:6px;border-top-color:var(--dsu-tip-edge)}
.dsu-tip[data-side="above"]::after{top:100%;left:50%;transform:translateX(-50%) translateY(-1px);border-width:5px;border-top-color:var(--dsu-tip-surface)}
.dsu-tip[data-side="below"]::before{bottom:100%;left:50%;transform:translateX(-50%);border-width:6px;border-bottom-color:var(--dsu-tip-edge)}
.dsu-tip[data-side="below"]::after{bottom:100%;left:50%;transform:translateX(-50%) translateY(1px);border-width:5px;border-bottom-color:var(--dsu-tip-surface)}
.dsu-tipError{--dsu-tip-edge:var(--dsu-err);color:var(--dsu-err-text)}
.dsu-tipErrorText{display:block;color:var(--dsu-err-text);font-weight:600}
.dsu-errBadge{font-size:11px;line-height:18px;font-weight:600;color:var(--dsu-err-text);background:color-mix(in srgb,var(--dsu-err) 14%,transparent);border-radius:999px;padding:0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;flex:none}
.dsu-input{width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsu-input:hover:not(:disabled):not([aria-invalid="true"]){border-color:var(--dsw-alias-border-l3)}
.dsu-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}
.dsu-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dsu-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dsu-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsu-textarea{height:auto;min-height:72px;padding:8px 12px;line-height:1.6;resize:vertical}
.dsu-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsu-numberWrap{display:block;width:100%;min-width:0}
.dsu-number{position:relative;display:flex;align-items:center;gap:8px;min-width:0}
.dsu-number .dsu-input{min-width:0}
.dsu-number .dsu-input[type="number"]{appearance:textfield;-moz-appearance:textfield}
.dsu-number .dsu-input[type="number"]::-webkit-outer-spin-button,
.dsu-number .dsu-input[type="number"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.dsu-number .dsu-input.dsu-inputWithUnit{padding-right:32px}
.dsu-secret{position:relative;display:flex;align-items:center;width:100%;min-width:0}
.dsu-secretInput{padding-right:40px}
.dsu-secretEye{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;appearance:none;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsu-secretEye:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsu-secretEye:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-secretEye:disabled{opacity:.55;cursor:not-allowed}
.dsu-unit{position:absolute;right:9px;top:50%;transform:translateY(-50%);flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary);pointer-events:none}

.dsu-switch{appearance:none;width:36px;height:20px;border-radius:999px;border:0;padding:2px;background:var(--dsw-alias-border-l3);display:flex;align-items:center;cursor:pointer;flex:none;transition:background-color .16s}
.dsu-knob{width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .16s,background-color .16s}
.dsu-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary)}
.dsu-switch[aria-checked="true"] .dsu-knob{transform:translateX(16px);background:var(--dsw-alias-label-primary-foreground)}
.dsu-switch:disabled{opacity:.4;cursor:not-allowed}
.dsu-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsu-selectWrap{position:relative;width:100%;min-width:0}
.dsu-selectBare{width:auto;display:inline-flex}
.dsu-selectBare .dsu-select{height:28px;padding:0 26px 0 8px;font-size:12px;border-radius:var(--dsw-radius-sm,6px)}
.dsu-selectBare .dsu-chevron{position:absolute;right:8px;pointer-events:none}
.dsu-select{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer}
.dsu-select[aria-expanded="true"]{border-color:var(--dsw-alias-state-business-primary)}
.dsu-selectValue{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsu-select[aria-expanded="true"] .dsu-chevron{transform:rotate(180deg)}
.dsu-menu{box-sizing:border-box;position:fixed;position-area:block-end span-inline-end;justify-self:start;margin-top:6px;z-index:70;padding:4px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;box-shadow:0 12px 32px rgb(0 0 0 / 50%);max-height:280px;overflow:auto}
.dsu-option{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.4;width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left}
.dsu-option>span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsu-option:hover,.dsu-option[data-active="true"]{background:var(--dsw-alias-bg-layer-3)}
.dsu-option:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dsu-option:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsu-option[aria-selected="true"]{color:var(--dsw-alias-state-business-primary);font-weight:600}
.dsu-optionGroup{padding:6px 10px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dsu-check{opacity:0;flex:none}
.dsu-option[aria-selected="true"] .dsu-check{opacity:1}
.dsu-savebar.dsu-savebar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 14px;margin-top:18px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-card-fill);box-shadow:0 1px 2px rgb(0 0 0 / 12%)}
.dsu-saveInfo{display:flex;flex:1;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0}
.dsu-savebar .dsu-btn{flex:none}
.dsu-savebar.dsu-savebar[data-dirty="true"]{position:sticky;bottom:0;z-index:2;background:var(--dsw-alias-card-fill);background:color-mix(in srgb,var(--dsw-alias-card-fill) 92%,transparent);-webkit-backdrop-filter:blur(16px) saturate(130%);backdrop-filter:blur(16px) saturate(130%);box-shadow:0 -6px 16px rgb(0 0 0 / 22%)}
.dsu-btn{appearance:none;height:32px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:550;line-height:1.5;border-radius:6px;padding:0 12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background-color .12s,border-color .12s,color .12s,filter .12s}
.dsu-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3)}
.dsu-btn:active:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dsu-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-btn:disabled{opacity:.4;cursor:not-allowed}
.dsu-btnSm{height:28px;padding:0 10px;font-size:12px}
.dsu-btnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}
.dsu-btnGhost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:transparent;color:var(--dsw-alias-label-primary)}
.dsu-btnPrimary{background:var(--dsw-alias-button-primary-fill);border-color:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsu-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover)}
.dsu-btnPrimary:active:not(:disabled){filter:brightness(.9)}
.dsu-btnDanger{color:var(--dsu-err-text);background:color-mix(in srgb,var(--dsu-err) 10%,transparent);border-color:transparent}
.dsu-btnDanger:hover:not(:disabled){color:var(--dsu-err-text);border-color:transparent;background:color-mix(in srgb,var(--dsu-err) 20%,transparent)}
.dsu-stack{display:flex;flex-direction:column;gap:8px}
.dsu-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dsu-inlineRow{display:flex;align-items:center;gap:8px;min-width:0}
.dsu-grow{flex:1 1 240px;min-width:0}
.dsu-actionsEnd{justify-content:flex-end}
.dsu-status{margin-right:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-statusError{color:var(--dsu-err-text)}
.dsu-statusDirty{color:var(--dsu-warn-text)}
.dsu-dirtyPill{flex:none;font-size:11px;font-weight:600;border-radius:999px;padding:2px 10px;background:color-mix(in srgb,var(--dsu-warn) 16%,transparent);color:var(--dsu-warn-text);white-space:nowrap}
.dsu-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:550;line-height:1.5;border-radius:999px;padding:2px 10px;white-space:nowrap}
.dsu-badgeNeutral{background:var(--dsw-alias-card-tile-fill);color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l2)}
.dsu-badgeBusiness{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}
.dsu-badgeOk{background:color-mix(in srgb,var(--dsu-ok) 14%,transparent);color:var(--dsu-ok-text)}
.dsu-badgeWarn{background:color-mix(in srgb,var(--dsu-warn) 16%,transparent);color:var(--dsu-warn-text)}
.dsu-badgeErr{background:color-mix(in srgb,var(--dsu-err) 14%,transparent);color:var(--dsu-err-text)}
.dsu-dot{width:8px;height:8px;border-radius:999px;flex:none;display:inline-block}
.dsu-dotOk{background:var(--dsu-ok-text)}
.dsu-dotWarn{background:var(--dsu-warn-text)}
.dsu-dotErr{background:var(--dsu-err-text)}
.dsu-dotMute{background:var(--dsw-alias-label-tertiary)}
.dsu-callout{display:flex;gap:10px;align-items:flex-start;border-radius:var(--dsw-radius-sm,8px);padding:10px 14px;font-size:14px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.dsu-calloutInfo{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent)}
.dsu-calloutOk{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.dsu-calloutWarn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent)}
.dsu-calloutErr{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent)}
.dsu-calloutIcon{flex:none;width:16px;height:16px;border-radius:999px;display:grid;place-items:center;margin-top:1px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsu-calloutIconOk{background:var(--dsu-ok-text)}
.dsu-calloutIconWarn{background:var(--dsu-warn-text)}
.dsu-calloutIconErr{background:var(--dsu-err-text)}
.dsu-kpiGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(138px,100%),1fr));gap:10px;margin-top:8px}
.dsu-kpi{min-width:0;background:var(--dsw-alias-card-tile-fill);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,12px);padding:12px 14px}
.dsu-kpiLabel{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsu-kpiValue{margin-top:4px;font-size:22px;font-weight:650;line-height:1.2;letter-spacing:-.01em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.dsu-kpiUnit{margin-left:2px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary)}
.dsu-kpiSub{margin-top:4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
@property --dsu-count-target{syntax:"<integer>";initial-value:0;inherits:false}
.dsu-kpiValue[data-count]{font-size:0;animation:dsu-count-up 620ms cubic-bezier(.22,.61,.36,1) forwards;counter-reset:dsu-count var(--dsu-count-target)}
.dsu-kpiValue[data-count]::after{content:counter(dsu-count) / "";font-size:22px;font-variant-numeric:tabular-nums}
@keyframes dsu-count-up{from{--dsu-count-target:0}}
@container (max-width: 620px) {
  .dsu-fieldCols,
  .dsu-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion:reduce){.dsu-kpiValue[data-count]{animation-duration:1ms}}
.dsu-kpiDelta{display:inline-block;margin-top:6px;font-size:12px;font-weight:600;border-radius:999px;padding:2px 8px}
.dsu-kpiDeltaUp{color:var(--dsu-ok-text);background:color-mix(in srgb,var(--dsu-ok) 14%,transparent)}
.dsu-kpiDeltaDown{color:var(--dsu-err-text);background:color-mix(in srgb,var(--dsu-err) 14%,transparent)}
.dsu-tblWrap{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);overflow:hidden;overflow-x:auto}
.dsu-tblScroll{max-height:420px;overflow:auto}
.dsu-tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}
.dsu-tbl th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-card-tile-fill);text-align:left;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsu-tbl th.dsu-tblNum{text-align:right}
.dsu-tbl td{padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);vertical-align:middle}
.dsu-tbl tbody tr:last-child td{border-bottom:0}
.dsu-tbl tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-tblSticky th:first-child,.dsu-tblSticky td:first-child{position:sticky;left:0;z-index:1;width:1px;white-space:nowrap;background:var(--dsw-alias-card-tile-fill)}
.dsu-tblSticky thead th:first-child{z-index:3}
.dsu-tblSticky tbody td:first-child{box-shadow:inset -1px 0 0 var(--dsw-alias-border-l2)}
.dsu-tblSticky th:last-child,.dsu-tblSticky td:last-child{width:100%}
.dsu-tblEllip{display:block;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-tblTip{position:fixed;z-index:90;box-sizing:border-box;max-width:360px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);box-shadow:0 12px 32px rgb(0 0 0 / 45%);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:normal;overflow-wrap:anywhere;pointer-events:none}
.dsu-tblNum{text-align:right;font-variant-numeric:tabular-nums}
.dsu-tblId{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsu-tblSub{display:block;margin-top:2px;font-size:11px;line-height:1.35;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsu-tblMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dsu-tblFoot{padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-card-tile-fill);font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-meter{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.dsu-meterTrack{flex:none;width:64px;height:6px;border-radius:999px;background:var(--dsw-alias-border-l2);overflow:hidden}
.dsu-meterFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}
.dsu-meterFillOk{background:var(--dsu-ok-text)}
.dsu-meterFillWarn{background:var(--dsu-warn-text)}
.dsu-meterNum{flex:none;min-width:38px;text-align:right;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsu-log{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);overflow:hidden;background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-3))}
.dsu-logHead{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsu-logActions{margin-left:auto;display:flex;gap:2px}
.dsu-logAction{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;padding:2px 6px;border-radius:4px;cursor:pointer}
.dsu-logAction:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsu-logAction:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-logBody{margin:0;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.dsu-logOk{color:var(--dsu-ok-text)}
.dsu-logWarn{color:var(--dsu-warn-text)}
.dsu-logErr{color:var(--dsu-err-text)}
.dsu-seg{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3)}
.dsu-segBtn{appearance:none;border:0;background:transparent;font:inherit;font-size:12.5px;font-weight:550;line-height:1.5;color:var(--dsw-alias-label-secondary);padding:5px 14px;border-radius:calc(var(--dsw-radius-md) - 2px);cursor:pointer;transition:background-color .15s,color .15s}
.dsu-segBtn:hover{color:var(--dsw-alias-label-primary)}
.dsu-segBtn[aria-selected="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.dsu-segBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-empty{display:flex;flex-direction:column;align-items:center;border:.5px dashed var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,12px);padding:26px;text-align:center;font-size:14px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.dsu-emptyPlain{border:0}
.dsu-emptyIcon{width:40px;height:40px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);display:inline-grid;place-items:center;margin-bottom:8px;flex:none}
.dsu-emptyIcon svg{display:block}
.dsu-emptyTitle{display:block;margin-bottom:4px;font-size:14px;font-weight:550;color:var(--dsw-alias-label-secondary)}
.dsu-emptyBody{display:block;font-size:14px;color:var(--dsw-alias-label-tertiary)}
.dsu-toolrow{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,12px);padding:12px 14px;background:var(--dsw-alias-card-fill);transition:border-color .15s}
.dsu-toolrow:hover{border-color:var(--dsw-alias-border-l3)}
.dsu-toolrowHead{display:flex;align-items:center;gap:8px;margin-bottom:8px;min-width:0}
.dsu-toolrowName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsu-toolrowPhase{margin-left:auto;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.dsu-toolrowKv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 16px;font-size:12px}
.dsu-toolrowKey{color:var(--dsw-alias-label-tertiary)}
.dsu-toolrowVal{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary);word-break:break-all}
.dsu-toolrowValOk{color:var(--dsw-alias-state-success-primary)}
.dsu-toolrowValWarn{color:var(--dsw-alias-state-warn-primary)}
.dsu-toolrowValErr{color:var(--dsw-alias-state-error-primary)}
.dsu-toolrowFoot{display:flex;justify-content:flex-end;margin-top:8px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsu-fieldCols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}
.dsu-fieldCols>.dsu-field{display:flex;margin:0 -8px;padding:4px 8px}
.dsu-fieldCols>.dsu-field .dsu-control{margin-top:0;max-width:none}
.dsu-form{container-type:inline-size}
.dsu-sectionToggle{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsu-sectionToggleLabel{font-weight:500}
.dsu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:6px 14px}
.dsu-grid>.dsu-field{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:4px 8px;margin:0 -8px;border-radius:var(--dsw-radius-sm,6px);transition:background-color .15s}
.dsu-grid>.dsu-field:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsu-grid>.dsu-field .dsu-control{width:100%}
.dsu-toggleGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 6px}
.dsu-toggleCell{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);min-width:0}
.dsu-toggleCell .dsu-label{font-size:13px;font-weight:500;line-height:1.35;min-height:0}
.dsu-toggleCell .dsu-helpBtn{width:20px;height:20px}
.dsu-toggleCell .dsu-control{width:auto;flex:none}
.dsu-toggleCell>.dsu-switch{flex:none}
.dsu-insights{width:100%;max-width:860px;margin:0 auto}
@media (pointer:coarse){
  .dsu-helpBtn{width:32px;height:32px}
}
@media (max-width:640px){
  .dsu-fieldCols{grid-template-columns:minmax(0,1fr)}
  .dsu-toggleGrid{grid-template-columns:minmax(0,1fr)}
  .dsu-field{margin:0 -8px;padding:4px 8px}
  .dsu-control{width:100%;max-width:none}
  .dsu-section{margin-top:18px;padding-top:12px}
}
@media (prefers-reduced-motion:reduce){
  .dsu-switch,.dsu-knob,.dsu-chevron,.dsu-btn,.dsu-field,.dsu-grid>.dsu-field,.dsu-segBtn,.dsu-toolrow,.dsu-toggleCell{transition:none}
}
@container (max-width: 620px) {
  .dsu-fieldCols,
  .dsu-grid { grid-template-columns: minmax(0, 1fr); }
}

`;
