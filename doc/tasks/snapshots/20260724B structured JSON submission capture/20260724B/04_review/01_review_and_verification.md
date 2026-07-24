# 20260724B Review and Verification

## 总体判断

本轮同时审阅代码和文档，因为task已经落地Macro schema、visual editor、runner、HTTP/CLI、evidence、测试、active specs与Quickstart。最终实现满足用户拍板的无step ID方案：identity只来自当前Shell注入的Room generation、terminalId与launchId，当前root Flow structured Capture只消费第一份schema-valid提交。typed JSON既可由`json_match`按字段消费，也可通过唯一canonical compact projection进入全部正式textual consumer。Visual editor还可从当前合法Schema查看建议提示词；复制只是快捷路径，clipboard失败时完整正文仍允许手动选择。

post-review发现的共享Ajv registry、Schema-unaware reference扫描、HTTP错误归一/验证顺序、raw invalid schema保留、开发机路径固化和typed JSON无法再次进入textual consumer的问题均已在当前change修复并补回归。最终未发现未解决P1/P2，全部Gate无warning、error、skip或异常retry，可以通过Close Gate。

## Gate 结论

| Gate | 结论 | 证据 |
| --- | --- | --- |
| Formal Document Gate | 通过 | 用户确认无step ID、Room隔离、stdin CLI、JSON Schema与JSON If方案；`00_meta`、context、spec、execution完整。 |
| Execution Gate | 通过 | 四阶段计划、Legacy Kill List、P1/P2停止线和顺序验证入口已冻结。 |
| Focused Code/Test Gate | 通过 | `just test-20260724b`顺序入口：27项unit/integration、175个断言和2项Chromium E2E通过；覆盖Schema-aware ref、HTTP path/body顺序、canonical justfile env、raw invalid draft、建议提示词分隔格式、clipboard fallback、全部textual selector及真实Capture→Send payload。 |
| Static Gate | 通过 | `just check`：323个project-authored code source均不超过400行，style residue clean，TypeScript clean，Svelte 0 error/0 warning。 |
| Build Gate | 通过 | `just build`：393 modules，production assets成功生成，无warning。 |
| Full Unit/Integration Gate | 通过 | theme 6项、unit core 236项/2227个断言、integration 50项/461个断言全部通过。 |
| Full E2E Gate | 通过 | 单worker Chromium 57/57通过，包含structured JSON textual authoring、复杂Macro、Room sync、大replay和theme matrix。 |
| Diff Gate | 通过 | `just diff-check`通过。 |
| Current Docs Gate | 通过 | Macro、Capture ingest、run evidence、architecture active specs及Quickstart均已同步。 |
| jj Gate | 通过 | `vxmzmxzp`是目标change，parent为`20260724A`；工作区`conflict=false`。 |
| Close Gate | 通过 | contract、实现、测试、current docs与index一致，未解决P1/P2为零。 |

## Findings and Solutions

### 1. 共享Ajv registry会让合法saved schema重复编译失败

* 级别：P2 / L1
* 位置：`src/lib/macro/structuredJson.ts`的`compileStructuredJsonSchema`
* 问题：初版复用module-global Ajv instance。带`$id`的schema第一次compile成功，用新object identity再次compile会报`schema with key or id ... already exists`。
* 为什么重要：同一definition会在Save、preflight、Start和runtime边界重复validation；合法schema可能保存成功却无法启动，属于quietly wrong。
* 证据：post-review用两个内容相同、identity不同的`{$id,type}`对象复现first ok/second error。
* 推荐处理：每次validation创建隔离的Ajv 2020 instance；以Schema-aware traversal拒绝真正subschema位置上非`#`开头的`$ref/$dynamicRef`；issue排序使用code-point comparator。
* 修改归属：代码与文档一起改。
* 是否阻断 Gate：是；已修复并由重复`$id`、local fragment、remote ref unit回归覆盖。

### 2. malformed body与inactive Room没有完全兑现structured错误contract

* 级别：P2 / L1
* 位置：`server/http/roomRoutes.ts`的structured route；`server/structuredJsonIngest.ts`的lifecycle error mapping
* 问题：初版malformed request JSON会逃逸为通用`invalid_request_json`，不存在或正在销毁的Room会透出通用Room error；token检查也发生在Room path token解析之后。第一次修复后仍在exact body之前解析path，导致malformed path抢先返回generated-id错误。
* 为什么重要：CLI需要稳定、可操作的失败码，且token必须先于body解析；stale Room不能与terminal membership使用两套含糊结果。
* 证据：route原先直接`await requestJson(req)`，ingest catch原先原样返回`room_not_found/room_destroying`；后续审阅又以合法token + malformed body/path组合复现错误优先级。
* 推荐处理：依次校验token、malformed/exact body、path Room与runtime membership；body错误统一422 `structured_json_submission_invalid`，body通过后的malformed/inactive Room及identity mismatch统一404 `structured_json_runtime_membership_mismatch`。
* 修改归属：代码与文档一起改。
* 是否阻断 Gate：是；已修复，并由bad-token malformed body、valid-token malformed body、malformed path/body组合、malformed path/valid body及已销毁Room integration回归覆盖。

### 3. parse-valid但schema-invalid的raw editor文本会被改写

* 级别：P3 / L1
* 位置：`src/lib/components/macro/CaptureSourceEditor.svelte`的`changeSchema`
* 问题：初版把`"not-a-schema"`解析成普通string再存入临时invalid draft，重绘时会丢失原始引号。第一次修复只检查object/boolean shape，`{"type":7}`这类parse-valid但compile-invalid object仍会被pretty-print。
* 为什么重要：Save仍会失败，但visual raw JSON字段没有逐字保留用户正在修复的invalid输入。
* 证据：原实现对任何`JSON.parse`成功值直接赋给`schema`；后续实现的`isJsonSchema`只证明JSON shape，不证明Schema合法。
* 推荐处理：只有`compileStructuredJsonSchema(parsed).ok`时才存parsed schema；parse失败或compile失败都保存完整原始文本。
* 修改归属：只改代码。
* 是否阻断 Gate：否；已修复，并由focused Playwright精确断言带引号string和parse-valid invalid object文本均逐字保留。

### 4. 单独复制提示词无法覆盖clipboard权限失败

* 级别：P3 / L1
* 位置：`src/lib/components/macro/CaptureSourceEditor.svelte`的structured JSON authoring。
* 问题：仅提供Copy会让clipboard权限被拒绝的用户拿不到Schema-derived提示词；直接把内容写入Send又无法确定多个Send/branch中的唯一目标。Schema字段同时曾用独立`maxRows={14}`，偏离普通multiline高度。
* 为什么重要：参考提示词的目的正是降低stdin命令、成功条件和schema retry的遗漏概率；它不能依赖一项可能被browser拒绝的权限，也不能隐式改写不确定的draft位置。
* 推荐处理：合法Schema只提供`View suggested prompt`，用daisyUI modal显示完整、可聚焦且可选择的只读textarea；完整参考文本以上下相同的`------------`包裹，分隔线与正文间及区块前后保留换行。modal内Copy成功给出状态，失败保持正文并提示手动复制。不自动改写Send；invalid Schema禁用入口；Schema editor删除独立行数上限。
* 修改归属：代码与文档一起改。
* 是否阻断 Gate：否；已修复，并由focused E2E覆盖统一高度、入口状态、prompt内容、clipboard成功和拒绝fallback。

### 5. 普通JSON data中的`$ref`会被误当成Schema keyword

* 级别：P2 / L1
* 位置：`src/lib/macro/structuredJson.ts`的`validateLocalSchemaReferences`
* 问题：初版递归遍历每个JSON object并检查所有同名key，导致`properties:{"$ref":...}`、`$defs` map key和`const/enum/examples` instance data中的`$ref/$dynamicRef`被误拒。
* 为什么重要：这些是合法JSON Schema 2020-12；误拒会让portable Macro无法Save或Start，直接违背冻结的Schema contract。
* 证据：以property名`$ref/$dynamicRef`、同名`$defs` key和包含remote-looking字符串的`const/enum/examples`均可复现。
* 推荐处理：只在当前schema object检查reference keyword，并仅沿single/array/map标准subschema keyword把真正child schema加入worklist；不遍历annotation或instance data。
* 修改归属：代码与测试。
* 是否阻断 Gate：是；已修复。unit同时证明上述合法反例通过、nested真正remote `$dynamicRef`仍失败。

### 6. 建议提示词固化了单一checkout绝对路径

* 级别：P3 / L2
* 位置：`src/lib/macro/structuredJson.ts`的prompt builder；`server/httpServer.ts`的terminal env provider。
* 问题：初版直接写入`/home/hxse/dev/shell-deck/justfile`，checkout换目录后提示词立即失效，测试也把开发机路径误当contract。
* 为什么重要：Shell terminal可从任意cwd工作，recipe定位应由启动该terminal的current server统一提供，而不是由browser猜测部署路径。
* 证据：prompt helper与Quickstart均包含同一个开发机absolute path。
* 推荐处理：server用当前module位置解析并realpath canonical justfile，向每个Shell注入`SHELL_DECK_JUSTFILE`；提示词和guide统一使用`just -f "$SHELL_DECK_JUSTFILE" submit-json`。
* 修改归属：代码与文档一起改。
* 是否阻断 Gate：否；已修复，并由integration精确断言terminal env路径和unit/E2E prompt oracle覆盖。

### 7. typed JSON Capture无法再次进入Send及同类textual consumer

* 级别：P2 / L1
* 位置：`macroDefinitionTypes.ts`、`macroReferenceValidation.ts`、`macroTextEvaluation.ts`及相关Visual selector。
* 问题：初版把所有text consumer source限制为text artifact；`captured_json`只能进入`json_match`，无法再次Send，也无法用于Notify message、Input default、Extract Text、`text_match`或Parallel lane Send。
* 为什么重要：schema-valid JSON会成为typed dead end；用户只能要求上游重复输出text、手改JSON或引入第二份真值，破坏structured Capture的核心价值。
* 证据：validator和所有Visual selector都显式过滤`captured_json`，runtime `readMacroArtifact`也只接受`kind:"text"`。
* 推荐处理：artifact仍只保存typed JSON；全部正式textual consumer共用read-boundary canonical compact projection。object key递归稳定排序，JSON representation无缩进、无末尾换行；`json_match`继续typed-only，Parallel final Output继续lane-local text-only。
* 修改归属：代码、测试与文档一起改。
* 是否阻断 Gate：是；已修复。unit覆盖所有consumer与kind mismatch，integration证明Capture后Send真实terminal payload，focused E2E覆盖root/Parallel authoring selector。

## 需要人工拍板

无。公开方案已由用户拍板，post-review修复均为对已冻结contract的无分叉对齐。

## AI 可直接修

上述P2/L1与P3/L1均已在当前change修复；没有待修项。

## 未覆盖与残余风险

* 未调用真实在线Codex/model。该链路故意是program-agnostic，已用真实HTTP server、terminal注入environment、CLI adapter、runner和browser authoring覆盖本地端到端语义；外部模型是否遵循提示词仍由用户prompt负责。
* memory-only token保护正常使用中的跨Room误投，不防同一OS用户下主动读取其他process environment并伪造请求；这是local single-user V0明确范围外。
* 不测试或支持server restart后的waiter恢复、submission queue、Parallel structured Capture、step token和remote schema registry；这些均是正式范围外。
* Ajv与建议提示词modal进入browser bundle后，main asset为451.61 kB / gzip 130.37 kB。当前没有bundle budget或加载warning；主要成本仍来自采用完整JSON Schema 2020-12而非私有DSL。

## 审阅范围

审阅基线是当前change parent `20260724A`。范围覆盖全部task/index、Quickstart、四份相关active spec、Macro types/validator/editor/artifact choices、typed JSON textual projection、Schema-aware reference traversal、raw draft、Schema-derived建议提示词与clipboard fallback、runner lifecycle/interaction/evidence、Room membership/HTTP route验证顺序、terminal canonical justfile environment、stdin CLI、unit/integration/E2E与全部新增dependency和just/package入口。

旧痕迹扫描确认没有step token、manual Room/terminal CLI参数、独立端口、submission queue、持久化stringified-JSON fallback、`captured_text`双写、per-consumer JSON serializer或Parallel structured option；正式textual projection只有共享read boundary一处。所有新增与既有project-authored code均通过零例外400行Gate。
