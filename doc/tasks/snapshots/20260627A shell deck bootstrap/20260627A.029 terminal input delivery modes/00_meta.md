# 20260627A.029 Terminal Input Delivery Modes

## 任务概括

在 `.028` 的精确 ending bytes 之上增加 terminal input delivery contract。Macro 同时支持 Auto、Direct bytes 与 Bracketed paste；Auto 按 target tab capability 在 Shell 解析为 Bracketed paste、在 Text 解析为 Direct bytes，再把 ending 放在正文或 paste end marker 之外。Codex 等启用 bracketed paste 的 raw-mode TUI 因而能区分“批量正文”和随后独立的 CR submit，Text panel 也不会显示 `[200~` / `[201~` 残片。

## 正式 task 级别及定级原因

三星任务。

本任务再次破坏性修改公开 Macro JSON，并影响 type/validator/store/import、target capability resolution、runner wire payload、run-event artifact、普通与 parallel editor、Text panel、真实 PTY、Current Docs 和大量 fixtures。错误实现可能把 ESC framing 泄漏给 Text，也可能让 Auto 隐藏实际 wire，或在 content 与 ending 之间制造不可恢复的两阶段副作用。因此必须用完整 Spec、Execution、真实 Shell/Text/Codex smoke、AI pre/post-review 和 Breaking Close Gate 收口。

## 范围内

* `send`、`input` 和 parallel lane `send` 必须显式存储 `delivery: "auto" | "direct" | "bracketed-paste"`。
* 新建 action 显式默认 `delivery: "auto"`；UI 使用单一 Input delivery select，并为 Auto 提供精确 tooltip。
* Auto 在 action 实际写入时按 current target capability 解析：Shell -> bracketed-paste，Text -> direct；显式 Direct/Bracketed paste 永远强制覆盖。
* `direct` 保持 `content + ending`；`bracketed-paste` 使用 `ESC[200~ + content + ESC[201~ + ending`。
* Ending 继续只表达 None/LF/CR/CRLF 原始后缀，默认 CR；不增加 Ending Auto。
* Resolved bracketed 内容包含 end marker 时，在任何 terminal write 之前 fail loudly。
* Current `terminal_text_sent` event 同时记录 requested `delivery` 与 actual `resolvedDelivery`；write artifact 保存完整 wire payload。
* 更新 unit/integration/E2E、真实 Shell/Text/Codex smoke、focused just 入口、active specs、guide、task index 和最终 review evidence。
* 默认 current-schema-only hard cut：旧 template 缺少 `delivery` 时失败，不迁移、不补默认值。

## 范围外

* 不增加 Codex 进程识别、TUI brand/profile 特判或 wrapper 自动注入 `disable_paste_burst`。
* 不增加固定 sleep、paced typing、两阶段 content/ending write 或对应 phase cursor。
* Auto 不解析/追踪 DEC mode 2004，不识别 foreground process，不根据正文猜测，也不做 runtime fallback。
* Ending enum 不增加 `auto`。
* 不增加 keyboard-event、special-key 或通用 escape-sequence DSL。
* 不改变 `.025/.026` 的 occurrence-aware pause/resume，也不重写历史 task snapshots 或 append-only run events。
* 不重写已有 explicit Direct/Bracketed paste template；它们继续按用户选择执行。
