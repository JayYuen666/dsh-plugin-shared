/** 设置卡统一样式。颜色/圆角全部走宿主主题令牌。 */
export const CARD_UI_CSS = `
.dsu-form{display:flex;flex-direction:column}
.dsu-section{margin-top:24px;padding-top:24px;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsu-form>.dsu-section:first-child{margin-top:0;padding-top:0;border-top:0}
.dsu-sectionTitle{margin:0;font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dsu-sectionHint{margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-statusbar{display:flex;flex-wrap:wrap;gap:4px 8px;margin-top:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-field{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,360px);column-gap:32px;align-items:center;padding:12px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsu-fieldMeta{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsu-labelRow{display:flex;align-items:center;gap:6px;min-width:0}
.dsu-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsu-labelMono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dsu-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsu-control{min-width:0;display:flex;align-items:center;gap:8px}
.dsu-fieldWide{grid-template-columns:minmax(0,1fr);align-items:start}
.dsu-fieldWide .dsu-control{width:100%;max-width:720px;margin-top:2px}
.dsu-help{display:inline-flex;align-items:center;gap:6px;min-width:0}
.dsu-helpBtn{appearance:none;border:0;background:transparent;padding:0;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:help;border-radius:50%;flex:none}
.dsu-help:hover .dsu-helpBtn,.dsu-helpBtn:focus-visible{color:var(--dsw-alias-label-primary)}
.dsu-helpBtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-tip{position:fixed;z-index:60;box-sizing:border-box;max-width:min(340px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;overflow-wrap:anywhere;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);box-shadow:0 12px 32px rgb(0 0 0 / 45%);font-size:12px;line-height:1.6;font-weight:400;color:var(--dsw-alias-label-secondary)}
.dsu-input{width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.dsu-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dsu-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
.dsu-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dsu-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsu-textarea{height:auto;min-height:96px;padding:8px 12px;line-height:1.6;resize:vertical}
.dsu-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsu-numberWrap{display:flex;flex-direction:column;gap:4px;width:100%;min-width:0}
.dsu-number{display:flex;align-items:center;gap:8px;min-width:0}
.dsu-number .dsu-input{min-width:0}
.dsu-unit{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-error{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary)}
.dsu-switch{appearance:none;width:36px;height:20px;border-radius:999px;border:0;padding:2px;background:var(--dsw-alias-border-l3);display:flex;align-items:center;cursor:pointer;flex:none;transition:background-color .16s}
.dsu-knob{width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .16s,background-color .16s}
.dsu-switch[aria-checked="true"]{background:var(--dsw-alias-label-primary)}
.dsu-switch[aria-checked="true"] .dsu-knob{transform:translateX(16px);background:var(--dsw-alias-label-primary-foreground)}
.dsu-switch:disabled{opacity:.4;cursor:not-allowed}
.dsu-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dsu-selectWrap{position:relative;width:100%;min-width:0}
.dsu-select{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer}
.dsu-select[aria-expanded="true"]{border-color:var(--dsw-alias-state-business-primary)}
.dsu-selectValue{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsu-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.dsu-select[aria-expanded="true"] .dsu-chevron{transform:rotate(180deg)}
.dsu-menu{position:fixed;z-index:70;padding:4px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;box-shadow:0 12px 32px rgb(0 0 0 / 50%);max-height:280px;overflow:auto}
.dsu-option{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.4;width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:8px;cursor:pointer;text-align:left}
.dsu-option:hover,.dsu-option[data-active="true"]{background:var(--dsw-alias-bg-layer-3)}
.dsu-option:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.dsu-option:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsu-optionGroup{padding:6px 10px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}
.dsu-check{opacity:0;flex:none}
.dsu-option[aria-selected="true"] .dsu-check{opacity:1}
.dsu-savebar{display:flex;align-items:center;gap:8px;padding:12px 0;margin-top:24px;border-top:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.dsu-savebar[data-dirty="true"]{position:sticky;bottom:0;z-index:2;box-shadow:0 -12px 24px rgb(0 0 0 / 35%)}
.dsu-btn{appearance:none;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;border-radius:var(--dsw-radius-md);padding:5px 14px;cursor:pointer;transition:background-color .12s,border-color .12s,color .12s,filter .12s}
.dsu-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3)}
.dsu-btn:active:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dsu-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsu-btn:disabled{opacity:.4;cursor:not-allowed}
.dsu-btnPrimary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsu-btnPrimary:hover:not(:disabled){background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);filter:brightness(.9)}
.dsu-btnPrimary:active:not(:disabled){background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);filter:brightness(.84)}
.dsu-btnDanger{color:var(--dsw-alias-state-error-primary)}
.dsu-btnDanger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}
.dsu-status{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dsu-statusError{color:var(--dsw-alias-state-error-primary)}
.dsu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:0 24px}
.dsu-grid>.dsu-field{display:flex;flex-direction:column;align-items:stretch;gap:6px;padding:10px 0;border-top:.5px solid var(--dsw-alias-border-l1)}
.dsu-grid>.dsu-field .dsu-control{width:100%}
@media (max-width:640px){
  .dsu-field{grid-template-columns:minmax(0,1fr);align-items:start}
  .dsu-control{width:100%;max-width:720px}
  .dsu-section{margin-top:20px;padding-top:20px}
}
@media (prefers-reduced-motion:reduce){
  .dsu-switch,.dsu-knob,.dsu-chevron,.dsu-btn{transition:none}
}
`;
