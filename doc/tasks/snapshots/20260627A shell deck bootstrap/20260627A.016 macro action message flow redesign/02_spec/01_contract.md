# Contract

## Scope

范围内：

* Flow V2 新建模板删除 `sleep` action；等待统一用 `wait`。
* Flow V2 新建模板删除 `parse` action；文本匹配直接放到 `if` condition。
* Flow V2 新建模板删除内置 `ai-json` parser action；AI parsing 通过用户自己运行的 Codex terminal + `send_line` / `capture-source` 编排。
* 删除 `wait.mode = capture-ready-or-user`；capture readiness 不再是 wait 职责。
* `capture-source` 的 AgentEvent 配置增加 agent adapter 选择；当前唯一可选值为 `codex`，但 schema/UI 必须以 dropdown/enum 表达。
* `send_line` 支持任意多个 literal text part 和 source artifact part，按用户排序机械拼接；不再提供 prepend/append/raw JSON 三套入口。
* `input_line` 重新收敛为 prompt + 用户运行时输入；可选一个 source artifact 作为输入框默认值，用户可编辑后再发送。
* 删除新范式里的 `parallel_all` / `merge_parallel_results`，改成更局限的 `parallel_send_capture`：并发执行多个普通 `send_line`，等待/抓取每个返回，并机械合并为一个 output artifact。
* `if` 支持结构化 text match condition：regex match 与 simple match；支持 whole-text 与 line-wise 模式。
* 新 GUI Flow palette 移除旧 flow 节点，改为 Py-like `if/elif/else/for/break/continue/return`。
* 明确 current-schema-only 边界：模板只按当前 schema 校验；不合法就是 `invalid_macro_template`。
* 本任务必须依赖 `20260627A.015 macro workbench component boundary stabilization` 完成后再进入实现；`.016` 实现只能改语言/schema/runner/node editor 内部，不得顺手重排 Macro workbench 顶层布局。

范围外：

* 不实现内置 AI JSON parser action。
* 不支持 string expression，例如 `if "foo" in capture`。
* 不让 `parse` 产出可发送消息。
* 不让 `wait` 产出数据或 artifact。
* 不提供旧模板格式兼容、迁移、quarantine、skip 或 silently ignore。
* 不自动迁移 v1 `steps` 模板；旧 run logs 仍可作为历史记录读取，但不代表旧模板可重跑。
* 不修改 `.014` 已冻结的 Macro workbench chrome/layout：Macro header、Template drawer/bar、Template CRUD toolbar、Run status dock、Editor/JSON/Trace 顶层 tabs、Trace tab placement、Prompt panel layout、side panel resize、terminal tab chrome。
* 不在 `MacroPanel.svelte` 里继续扩大耦合；`.016` 只消费 `.015` 拆出的 node editor / action palette 边界。若需要修改 workbench chrome，必须另开 layout task。

## Workbench Layout Guardrail

`.014` 是 Macro / Prompt / Run Log workbench UI cleanup 的布局真值。本任务不是 layout task。

实现 `.016` 时必须保持这些 invariants：

* Template 不与 Macro title / Editor tabs / New Save 等按钮挤在同一栏。
* Editor / JSON / Trace 保持 Macro 顶层 views。
* Run status / waiting input 保持顶部 dock；runner control 若沿用 `.014` 设计，不得被 action editor 改动挤入主编辑流。
* Actions / Flow palette 只能在 editor shell 的 node-editor 区域内调整内容，不能改变 workbench chrome。
* Trace 继续跟随 selected template，Run Log / AI Trace 使用同一份 run snapshot。
* 1080px 与常规桌面宽度下不得横向溢出或把 tool rail 挤到 editor 下方。

`.016` 的 e2e gate 必须继承 `.014` layout invariant 断言；不能因为重写 Flow V2 GUI 测试而删除这些断言。

## Revised Flow V2 Language Boundary

Flow V2 新建模板主路径只允许这些 actions：

* `send_line`
* `input_line`
* `wait`
* `capture-source`
* `extract_text`
* `parallel_send_capture`

Flow controls：

* `if` / `elif` / `else`
* `for`
* `break`
* `continue`
* `return`

Flow V2 新建模板禁止：

* `sleep`
* `parse`
* `parser`
* `ai-json`
* `capture-ready-or-user`
* `parallel_all`
* `merge_parallel_results`
* `send_artifact`
* v1 `branch` / `goto` / `next` / `loopGuard` / `pause` / `stop` / `complete` / `fail`

Current-schema-only hard cut：shell-deck 只支持当前 macro template schema：`schemaVersion: 2` + structured `body`。`schemaVersion: 1` / `steps` 等旧格式不是兼容对象，只是不合法模板。`templateStore.read()`、`templateStore.list()`、`templateStore.import()` 遇到不合法模板必须 fail loudly with `invalid_macro_template`；不得 skip、migrate、quarantine、silently ignore 或返回 legacy-specific error。

## Flow Control Palette Contract

新建 Flow V2 模板时，Flow palette 使用 Py-like 控件，但必须按上下文显示：

* root / 普通 block：`if`、`for`、`return`。
* `if` group 内：提供 `Add elif` 和 `Add else`，`elif` / `else` 不作为 root 独立节点。
* `for` body 及其嵌套 block：额外允许 `break`、`continue`。root 上不得创建 `break` / `continue`。

新建 Flow V2 模板主路径不得显示或创建旧 flow 节点：

* `branch`
* `goto`
* `pause`
* `stop`
* `complete`
* `fail`

GUI 规则：

* `pause` / `stop` 只属于 runner control，不属于模板节点。
* `complete` 语义迁移为 `return`。
* `branch` 语义迁移为 `if/elif/else`。
* `goto + loopGuard` 语义迁移为 `for/break/continue`。
* 新建模板不提供 “Legacy flow nodes” palette / drawer。
* 打开、导入或列表扫描到不合法模板时必须报 `invalid_macro_template`；不能显示为可编辑/可运行模板，也不能提供 legacy badge、ignore 或 compatibility 入口。

视觉要求：

* Actions 与 Flow Control 必须分栏显示。
* Flow Control 使用 block-tree / indentation 展示，不再用 flat `next` 串联。
* `if/elif/else` 在 UI 中作为同一个 group 编辑，不能散落成多个独立 step。
* `for` body、`if` branch body、`else` body 必须可折叠。

## Wait Contract

`wait` 只负责等待或暂停，不产出 artifact，不承载 capture readiness。

允许模式：

```json
{ "id": "wait_short", "type": "wait", "mode": "duration", "durationMs": 1500 }
```

```json
{
  "id": "wait_worker_quiet",
  "type": "wait",
  "mode": "terminal-quiet",
  "terminal": { "kind": "alias", "value": "worker" },
  "quietMs": 1000,
  "maxMs": 120000,
  "onTimeout": "pause"
}
```

```json
{
  "id": "wait_user_resume",
  "type": "wait",
  "mode": "user-continue",
  "prompt": "检查 terminal 后继续"
}
```

规则：

* `sleep duration` 迁移为 `wait.mode = duration`。
* `sleep until-resume` 迁移为 `wait.mode = user-continue`。
* `capture-ready-or-user` 删除。顺序流里需要 capture 时，直接在 wait 后或 wait 前显式放 `capture-source`。
* wait timeout 只允许 `pause` 或 `return` 这类明确控制结果；不隐式执行 capture。

## Capture Source Contract

`capture-source` 是唯一“从 terminal/agent 获得文本”的动作。

Terminal buffer：

```json
{
  "id": "capture_worker",
  "type": "capture-source",
  "capture": {
    "kind": "terminal-buffer",
    "terminal": { "kind": "alias", "value": "worker" },
    "mode": "scrollback-tail",
    "maxChars": 12000
  }
}
```

Terminal buffer modes：

* `scrollback-tail` 是默认模式，抓取 terminal replay tail 后渲染为“可见屏幕文本”：`\r` 表示回到行首而不是换行，`CSI K` 清行会生效，bracketed-paste / ANSI styling 控制码会被移除。这个模式产出的 `captured_text` 适合直接 `send_line` 转发或 `if.text_match` 判断。
* `raw-stream-tail` 是调试/直通模式，`captured_text` 指向原始 PTY 字符 tail；它可能包含 ANSI/control sequences，不保证适合直接发给 shell 执行。
* `capture-source` 负责文本清洗和提取；`send_line` 只按 `message.parts` 机械拼接并原样发送，不在 send 层做清洗。
* Shell 专用的“只抓命令返回值 / 只抓上一条命令 transcript”属于后续更窄 capture mode，不混入当前通用 `send_line` 语义。

Text box：

```json
{
  "id": "capture_notes",
  "type": "capture-source",
  "capture": {
    "kind": "text-box",
    "terminal": { "kind": "alias", "value": "notes" }
  }
}
```

* `text-box` 只能读取 `backend = text` 的 deck slot；如果目标是 shell/fake terminal，runner 必须报 `terminal_not_text_box`。
* `text-box` 产出的 `captured_text` 是文本框当前内容本身，不做 terminal screen 渲染，不支持 `mode` / `maxChars` / raw stream。

AgentEvent：

```json
{
  "id": "capture_codex_stop",
  "type": "capture-source",
  "capture": {
    "kind": "agent-event",
    "agent": { "kind": "codex" },
    "terminal": { "kind": "alias", "value": "reviewer" },
    "eventKind": "stop",
    "field": "last_assistant_message"
  }
}
```

UI 要求：

* `capture.kind` dropdown：`terminal-buffer` / `text-box` / `agent-event`。
* 当 `capture.kind = agent-event` 时显示 `agent.kind` dropdown；当前只有 `codex`，但不能把 Codex 写成隐式默认特判。
* 后续新增 agent 时扩展 `agent.kind` enum，不改 runner 核心 capture flow。

输出 artifact：

* `captured_text`：供 `extract_text` / `send_line` / `input_line` / `if` 引用。`scrollback-tail` 下指向 normalized visible-text artifact；`raw-stream-tail` 下指向 raw artifact；`text-box` 下指向纯文本框内容 artifact。
* raw/normalized artifact 可继续用于 run log trace，但宏语言主路径只引用 `captured_text`。

## Extract Text Contract

`extract_text` 是确定性的文本处理 action。它从 visible predecessor scope 中读取已有 text artifact，执行 split/filter/select/extract/trim，产出新的 `extracted_text` artifact。它不是旧 `parse`，不调用 AI，不返回 bool；bool 判断继续放在 `if.text_match`。

基础形态，提取最后一条非 prompt 行：

```json
{
  "id": "extract_last_line",
  "type": "extract_text",
  "source": { "kind": "step_artifact", "stepId": "capture_worker", "artifact": "captured_text" },
  "split": { "kind": "lines", "keepEmpty": false },
  "filters": [
    { "kind": "exclude", "matcher": { "kind": "regex", "pattern": "^\\s*[$#❯>]\\s*$" } }
  ],
  "select": { "mode": "last" },
  "extract": { "kind": "none" },
  "trim": "right",
  "onEmpty": "pause"
}
```

字段提取：

```json
{
  "id": "extract_result",
  "type": "extract_text",
  "source": { "kind": "step_artifact", "stepId": "capture_worker", "artifact": "captured_text" },
  "split": { "kind": "lines", "keepEmpty": false },
  "filters": [],
  "select": { "mode": "last" },
  "extract": { "kind": "regex", "pattern": "result:\\s*(.*)$", "group": 1 },
  "trim": "both",
  "onEmpty": "pause"
}
```

规则：

* `source` 可引用 `captured_text`、`merged_text`、`extracted_text`。
* `split.kind = lines | regex`；regex flags 只允许 `i/m/s`，非法 pattern validation error。
* `filters` 按顺序执行，支持 `include` / `exclude`，matcher 支持 simple ops 或 regex。
* `select.mode = first | last | all | index | range`；`index`、`range.start`、`range.end` 都是 zero-based，range end 为 exclusive。
* `extract.kind = none | regex`；regex 支持 number group 或 named group。
* `trim = none | left | right | both`。
* `onEmpty = pause | fail | return`；空输出必须可观察地暂停/失败/返回，不静默继续。
* runner 写 `text_extracted` event，记录 source/config/output artifact，node log 必须能追溯。

## Send Line Message Parts Contract

`send_line` 使用 `message.parts`，按顺序机械拼接文本。`parts` 是唯一消息拼接结构。`send_line.terminal` 可以指向普通 terminal，也可以指向 `backend = text` 的文本收集框；写入文本框时 runner 追加渲染后的文本，不启动 shell 命令。

基础形态：

```json
{
  "id": "send_capture_to_parser_terminal",
  "type": "send_line",
  "terminal": { "kind": "alias", "value": "parser" },
  "message": {
    "parts": [
      { "kind": "text", "text": "请分析下面输出，只返回结论：\n\n" },
      {
        "kind": "artifact",
        "source": { "kind": "step_artifact", "stepId": "capture_worker", "artifact": "captured_text" }
      }
    ]
  }
}
```

多段文本和 source 可以任意排序：

```json
{
  "id": "send_review_to_worker",
  "type": "send_line",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": {
    "parts": [
      { "kind": "text", "text": "根据审查结果修复以下问题：\n\n" },
      {
        "kind": "artifact",
        "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" }
      },
      { "kind": "text", "text": "\n\n只改必要文件，完成后说明验证命令。" }
    ]
  }
}
```

规则：

* `message.parts` 只允许 `{ kind: "text" }` 和 `{ kind: "artifact" }`。
* `text` part 可以为空字符串；用户想要换行、标题、分隔线，就自己写进 text part。
* `artifact` source 必须引用 visible predecessor scope 中的 artifact-producing step，可引用 `captured_text`、`merged_text`、`extracted_text`。
* 不提供 `message.join`；runner 按 part 顺序直接拼接，不自动加换行。
* 不再保存 `prepend` / `append` / `raw message JSON` / `user_input` part。
* GUI 必须提供 `Add Text` / `Add Source`，每个 part 可上移、下移、删除。
* 不支持 `parse -> send_line`；需要发送文本时直接引用 capture/merge/extract artifact。

## Input Line Contract

`input_line` 是“暂停等待用户输入，然后把最终文本发给目标 terminal 并回车”的动作。它不复用 `send_line.message.parts`，也不保存 `user_input` part。

基础形态：

```json
{
  "id": "ask_user_then_send",
  "type": "input_line",
  "terminal": { "kind": "alias", "value": "worker" },
  "prompt": "给 worker 的补充指令",
  "allowEmpty": false
}
```

带默认 source：

```json
{
  "id": "ask_user_with_review_context",
  "type": "input_line",
  "terminal": { "kind": "alias", "value": "worker" },
  "prompt": "基于默认内容修改后发送",
  "allowEmpty": false,
  "defaultSource": {
    "kind": "step_artifact",
    "stepId": "capture_review",
    "artifact": "captured_text"
  }
}
```

规则：

* `prompt` 只显示给用户，不自动发送。
* `defaultSource` 可选，最多一个；如果存在，runner 读取 source 文本并预填运行时输入框。
* 用户可以修改、删除、补充默认文本；提交后发送 textarea 的最终内容。
* 如果不需要人工修改，只想把 source 发给 terminal，应使用 `send_line` 的 artifact part。
* `defaultSource` 必须引用 visible predecessor scope 中的 artifact-producing step。

## If Text Match Condition

`if` 直接对 capture/merge artifact 做文本匹配，返回 bool。不存在独立 `parse` action。

Condition schema：

```json
{
  "kind": "text_match",
  "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" },
  "matcher": {
    "kind": "simple",
    "op": "contains",
    "text": "AI 可直接修"
  },
  "scope": { "kind": "whole" }
}
```

Regex：

```json
{
  "kind": "text_match",
  "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" },
  "matcher": {
    "kind": "regex",
    "pattern": "P[12]\\b",
    "flags": "i"
  },
  "scope": { "kind": "whole" }
}
```

Line-wise：

```json
{
  "kind": "text_match",
  "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" },
  "matcher": { "kind": "simple", "op": "contains", "text": "READY" },
  "scope": { "kind": "lines", "mode": "last", "includeEmptyLines": false }
}
```

Simple matcher ops：

* `contains`
* `not_contains`
* `equals`
* `not_equals`
* `starts_with`
* `ends_with`

Regex matcher ops：

* `regex` 通过 `matcher.kind = regex` 表达。
* regex 只返回 bool，不返回 capture groups；需要 capture group 时使用 `extract_text` 产出 `extracted_text`。
* regex flags V0 只允许 `i` / `m` / `s` 的组合；非法 flags validation error。

Scope：

* `whole`：对完整文本匹配一次。
* `lines.first`：只检查第一条参与匹配的行。
* `lines.last`：只检查最后一条参与匹配的行。
* `lines.any`：任意一行匹配即 true。
* `lines.all`：所有参与匹配的行都匹配才 true；默认忽略空行，除非 `includeEmptyLines = true`。

`if` 示例：

```json
{
  "id": "route_review",
  "type": "if",
  "branches": [
    {
      "kind": "if",
      "condition": {
        "kind": "text_match",
        "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" },
        "matcher": { "kind": "simple", "op": "contains", "text": "无问题" },
        "scope": { "kind": "whole" }
      },
      "body": [{ "id": "return_clean", "type": "return", "reason": "clean" }]
    }
  ],
  "else": [
    {
      "id": "send_findings",
      "type": "send_line",
      "terminal": { "kind": "alias", "value": "worker" },
      "message": {
        "parts": [
          { "kind": "text", "text": "修复这些问题：" },
          { "kind": "artifact", "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" } }
        ]
      }
    }
  ]
}
```

## AI Parsing Pattern

shell-deck 不提供 `ai-json` action。需要 AI parsing 时，用户用 terminal 编排：

```text
send_line -> parser terminal running Codex
wait terminal-quiet
capture-source parser terminal
if text_match parser output
```

示例：

```json
[
  {
    "id": "send_to_codex_parser",
    "type": "send_line",
    "terminal": { "kind": "alias", "value": "parser" },
    "message": {
      "parts": [
        { "kind": "text", "text": "请判断下面内容是否需要人工拍板，只回答 NEEDS_USER 或 OK。" },
        { "kind": "artifact", "source": { "kind": "step_artifact", "stepId": "capture_worker", "artifact": "captured_text" } }
      ]
    }
  },
  { "id": "wait_parser", "type": "wait", "mode": "terminal-quiet", "terminal": { "kind": "alias", "value": "parser" }, "quietMs": 1000, "maxMs": 120000, "onTimeout": "pause" },
  { "id": "capture_parser", "type": "capture-source", "capture": { "kind": "terminal-buffer", "terminal": { "kind": "alias", "value": "parser" }, "mode": "scrollback-tail", "maxChars": 4000 } },
  {
    "id": "if_needs_user",
    "type": "if",
    "branches": [
      {
        "kind": "if",
        "condition": {
          "kind": "text_match",
          "source": { "kind": "step_artifact", "stepId": "capture_parser", "artifact": "captured_text" },
          "matcher": { "kind": "simple", "op": "contains", "text": "NEEDS_USER" },
          "scope": { "kind": "whole" }
        },
        "body": [
          { "id": "ask_user", "type": "input_line", "terminal": { "kind": "alias", "value": "worker" }, "prompt": "人工拍板", "allowEmpty": false, "defaultSource": { "kind": "step_artifact", "stepId": "capture_parser", "artifact": "captured_text" } }
        ]
      }
    ]
  }
]
```

这保持 AI parse 可见、可干预、可替换，不在后台隐藏模型调用。

## Scenario Blueprints

### 场景一：审查后直接转发

```text
send_line -> terminal 1
wait terminal-quiet
capture-source terminal 1
if text_match(capture, regex/simple)
send_line ordered text/source parts -> terminal 2
```

### 场景二：用户自管 Codex parser terminal

```text
send_line -> terminal 1
wait terminal-quiet
capture-source terminal 1
send_line capture artifact -> terminal 2, where user runs Codex parser
wait terminal-quiet terminal 2
capture-source terminal 2
if text_match(capture from terminal 2)
```

## Parallel Send Capture

新范式删除 `parallel_all` / `merge_parallel_results` 作为新建 Flow V2 actions。它们只属于历史设计名，不再作为兼容入口。

新动作命名为 `parallel_send_capture`。它是一个受限并发发送封装，不是通用并发工作流语言。

职责：

1. 并发执行多个普通 `send_line` action。
2. 每个 `send_line` 必须指定不同 terminal。
3. 每个 send 后可选执行同一 terminal 的 `wait`；item wait 只允许 `duration` 或 `terminal-quiet`，且 `terminal-quiet.onTimeout` 只能是 `pause`。
4. 每个 item 使用普通 `capture-source` 抓取对应 terminal 的返回文本。
5. 按配置的合并方式和分割线样式机械合并所有 capture 文本。
6. 产出 `merged_text` artifact，供外部后续 `extract_text`、`if.text_match` 或 `send_line.message.parts` 引用。

它不允许：

* lane-local workflow。
* nested parallel。
* item 内 `input_line`。
* item 内 `if/for/break/continue/return`。
* item 内 parse 或 AI action。
* 默认发送 `echo ready` 或任何预设文本。发送内容必须来自用户配置的 `send_line.message.parts`。

目标 schema：

```json
{
  "id": "parallel_review",
  "type": "parallel_send_capture",
  "items": [
    {
      "id": "docs",
      "terminal": { "kind": "alias", "value": "docs_reviewer" },
      "send": {
        "id": "send_docs",
        "type": "send_line",
        "terminal": { "kind": "alias", "value": "docs_reviewer" },
        "message": {
          "parts": [{ "kind": "text", "text": "review docs only" }]
        }
      },
      "wait": {
        "id": "wait_docs",
        "type": "wait",
        "mode": "terminal-quiet",
        "terminal": { "kind": "alias", "value": "docs_reviewer" },
        "quietMs": 1000,
        "maxMs": 120000,
        "onTimeout": "pause"
      },
      "capture": {
        "id": "capture_docs",
        "type": "capture-source",
        "capture": {
          "kind": "terminal-buffer",
          "terminal": { "kind": "alias", "value": "docs_reviewer" },
          "mode": "scrollback-tail",
          "maxChars": 12000
        }
      }
    },
    {
      "id": "tests",
      "terminal": { "kind": "alias", "value": "tests_reviewer" },
      "send": {
        "id": "send_tests",
        "type": "send_line",
        "terminal": { "kind": "alias", "value": "tests_reviewer" },
        "message": {
          "parts": [{ "kind": "text", "text": "review tests only" }]
        }
      },
      "capture": {
        "id": "capture_tests",
        "type": "capture-source",
        "capture": {
          "kind": "terminal-buffer",
          "terminal": { "kind": "alias", "value": "tests_reviewer" },
          "mode": "scrollback-tail",
          "maxChars": 12000
        }
      }
    }
  ],
  "merge": {
    "kind": "sectioned_text",
    "separator": "===== {itemId} | {terminalAlias} =====",
    "order": "item_order",
    "includeEmptyCaptures": true
  },
  "onItemFail": "pause"
}
```

输出 artifact：

* `merged_text`：所有 item capture 的机械合并结果。
* 每个 item 的 raw/normalized capture artifacts 仍写入 run log，供追溯使用。

合并文本示例：

```text
===== docs | docs_reviewer =====
... docs terminal capture ...

===== tests | tests_reviewer =====
... tests terminal capture ...
```

复用规则：

* `parallel_send_capture.items[*].send` 必须使用普通 `send_line` 的同一套 schema，不另起 `send.text`/`command`/`prompt` 字段。
* `parallel_send_capture.items[*].capture` 必须使用普通 `capture-source` 的同一套 schema，不另起 lane-only capture 字段。
* GUI 应复用普通 `send_line` editor 和 `capture-source` editor；并发 item 只额外提供 item id、terminal 选择、可选 wait 和 merge 配置。
* 普通 `send_line` 支持的 ordered `message.parts` 和 artifact 引用，在 parallel item send 中同样可用；parallel item 不提供 prepend/append/raw JSON。
* 普通 `capture-source` 支持的 `terminal-buffer`、`text-box`、`agent-event`、`agent.kind` 选择，在 parallel item capture 中同样可用。
* Validator 只增加并发约束：每个 item resolved terminal 唯一，且 item terminal、send terminal、capture terminal 必须一致。

UI 要求：

* 点击 Add item 后，用户先选择 terminal。
* 选择 terminal 后，UI 展示该 item 的 `send_line` 配置和 `capture-source` 配置。
* item 可选 `wait` 配置；默认可以为空，但不能默认填入 `echo ready` 这类发送文本。
* 每个 item 的 send/capture 使用同一 terminal；如果用户手动改成不同 terminal，validator 必须报错。
* 多个 item 不能指向同一个 resolved terminal。
* merge 配置提供分割线样式输入，例如 `===== {itemId} | {terminalAlias} =====`。

外部使用示例：

```json
{
  "id": "send_parallel_result_to_worker",
  "type": "send_line",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": {
    "parts": [
      { "kind": "text", "text": "处理这些并发审查结果：" },
      { "kind": "artifact", "source": { "kind": "step_artifact", "stepId": "parallel_review", "artifact": "merged_text" } }
    ]
  }
}
```

`if.text_match` 也可以直接引用 `parallel_send_capture.merged_text`。

## Current Schema Boundary

* Shell-deck only supports the current macro template schema: `schemaVersion: 2` with a structured `body`.
* Files that do not validate against the current schema are invalid templates.
* The template store must fail loudly with `invalid_macro_template` from read/list/import paths; it must not skip, migrate, quarantine, silently ignore, or return legacy-specific compatibility errors.
* Existing run logs remain valid as history; old event kinds are not rewritten and do not imply old templates are runnable.
* Flow V2 validator rejects removed node types, removed control/parser fields, and removed structural values such as `kind = ai-json` or `mode = capture-ready-or-user`; literal user text may contain these words.
* Flow V2 send-from-artifact behavior must use `send_line.message.parts`, not a separate `send_artifact` action.

## Open Questions

当前建议直接拍板：

* `wait.user-continue` 是否命名为 `manual`？建议保留 `user-continue`，语义比 pause 更明确。
* `lines.all` 是否忽略空行？建议默认忽略空行，并提供 `includeEmptyLines`。
