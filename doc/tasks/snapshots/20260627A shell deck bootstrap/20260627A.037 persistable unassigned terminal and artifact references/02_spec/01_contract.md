# Contract

## 1. 前置与单一真值

本任务继承.032-.036的User Data Root、MacroRecord revision/content lease、Room controller、explicit Prepare、server-authoritative runner和Library storage。主要替换Macro definition/reference/validation contract，并负责V3 hard cut后saved-record list的独立隔离与显式诊断；不得让一个旧/损坏record把全部current V4 record从UI隐藏。

唯一current definition是`MacroDefinitionV4`。所有browser、server、Macro store、Library Validate/Save/Load、runner与tests必须直接消费V4；不得保留V3 alias、reader、migration或dual branch。

## 2. Exact reference schema

### 2.1 Terminal reference

```ts
type MacroTerminalReference =
  | { kind: "terminal_index"; index: number }
  | { kind: "unassigned" }
```

assigned branch要求exact keys、positive integer index，并由persistable validator检查`terminalLayout[index-1]`存在及Action capability兼容。unassigned branch只允许exact `{kind:"unassigned"}`，不接受payload。

以下字段破坏性改为`terminal: MacroTerminalReference`：

* root Send、Input、terminal-quiet Wait。
* Capture config的terminal-buffer/text-box/agent-event。
* Parallel lane。lane内Send/Wait/Capture继承lane terminal，不复制第二个slot。

旧`terminalIndex`字段一律unknown-field失败。

### 2.2 Artifact source

```ts
type StepArtifactSource = {
  kind: "step_artifact"
  stepId: string
  artifact: "captured_text" | "merged_text" | "extracted_text"
}

type RequiredArtifactSource =
  | StepArtifactSource
  | { kind: "unassigned" }
```

RequiredArtifactSource只用于：

* If/Elif `condition.source`。
* root/lane `extract_text.source`。
* Send/Notify MessagePart `{kind:"artifact",source}`。

Message artifact source在V4必须存在；`{kind:"artifact"}`是invalid schema。runner删除missing-source→empty-string分支。

`Input.defaultSource?: StepArtifactSource`仍是optional assigned-only source；缺失表示没有default。Parallel lane Output保持`StepArtifactSource | {kind:"none"}`；`none`表示明确不输出，不接受unassigned。

### 2.3 If exact example

```json
{
  "kind": "text_match",
  "source": { "kind": "unassigned" },
  "matcher": { "kind": "simple", "op": "contains", "text": "" },
  "scope": { "kind": "whole" }
}
```

只有source是reference slot。matcher/op/text/scope均为真实配置，不允许unassigned。

## 3. MacroDefinitionV4

```ts
type MacroDefinitionV4 = {
  schemaVersion: 4
  name: string
  description: string
  terminalLayout: Array<{ index: number; type: "shell" | "text" }>
  body: FlowNode[]
}
```

terminalLayout仍是portable logical truth，只保存连续index/type，不保存terminalId/launchId/cwd/Room。reference-driven authoring只从assigned terminal references计算最高引用并维护连续prefix；unassigned不贡献index。

## 4. 三层验证

### 4.1 Persistable definition

唯一入口：

* `validateMacroDefinitionV4(input)`
* `parseAndValidateMacroDefinitionJson(text)`

它检查exact V4 schema、Flow结构、unique id、已指派terminal index/layout/capability、已指派artifact earlier/scope/capability、template/regex与其他既有语义。`{kind:"unassigned"}`在白名单slot中合法且不产生persistable issue。

assigned但missing/future/wrong artifact、assigned terminal缺layout或capability mismatch仍是invalid definition；不得把错误assigned reference自动降级为unassigned。

Macro Create/Update、visual Save、JSON Save、Library Macro JSON Validate/Save/Load使用这一层。

### 4.2 Runnable completeness

唯一入口`validateRunnableMacroDefinitionV4(input)`先要求persistable，再递归检查所有运行必需slot。每个unassigned产生stable issue：

* `unassigned_terminal_reference`
* `unassigned_artifact_reference`

issue保持exact path与既有deterministic path/code排序。它不读取Room，也不改写definition。UI汇总可显示`N unassigned references`；server Start返回stable not-runnable response及issues。

### 4.3 Live Room validation

只有runnable definition进入live validation。它继续检查index/type、terminalId/launchId binding与readiness。Room missing/type mismatch/not-ready不影响Save；Start禁止。

判定顺序固定为persistable→runnable→Room→revision/controller/structure lock。server不得为了Room错误掩盖unassigned issue。

## 5. Visual editor

### 5.1 Selector

每个eligible terminal/artifact selector第一项都是可选择的`Unassigned`，不是disabled placeholder。用户可从assigned切回Unassigned；mutation直接把对应slot写成exact `{kind:"unassigned"}`。

默认规则统一且无例外：凡对应selector允许Unassigned，新建Action、把Wait切到terminal-quiet、添加If/Elif、添加root/parallel Extract、添加Parallel lane或artifact message part时，都直接写入exact `{kind:"unassigned"}`。即使已有compatible terminal或exact insertion point之前的earlier compatible output，它们也只出现在候选列表中，不得自动代选；用户显式选择才形成assigned reference。不得猜测terminal 1或earlier/future/sibling output，不得创建producer/terminal或隐式Prepare。

selected unassigned时selector下方显示局部warning：

* terminal：`Target is unassigned. Save is allowed, but Start requires a compatible terminal selection.`
* artifact：`Source is unassigned. Save is allowed, but Start requires an earlier compatible output.`

没有候选时可附加`Create a compatible terminal, then select it`或`Add or move an earlier compatible output`提示，但selector仍显示真实Unassigned option。

warning使用非阻断amber样式；不能伪装为red persistable validation error。Macro总体状态区同时显示persistable valid与runnable incomplete。

### 5.2 Explicit mutation

terminal live create/delete/reorder/readiness事件仍不得改写Macro draft。用户创建terminal后必须回selector显式选择。选择assigned terminal时按.034规则原子扩展连续layout prefix；切回unassigned后按所有剩余assigned references裁剪unused tail。

structure move/delete造成一个已指派artifact不再earlier/存在时，保留错误assigned reference并显示persistable error；本任务不静默清除用户选择。用户可显式选Unassigned后Save。

### 5.3 JSON editor

JSON editor纯文本，不读Room、不补引用。Save只调用V4 persistable text gateway；成功可包含unassigned。Validate/preview同时显示runnable completeness warning。

## 6. Save、Library、Prepare与Start

* Macro Save/Create/Update：persistable valid即可；保留.033/.034 lease/revision/Edit-session contract。
* Library Macro JSON Save：persistable valid即可；Prompt/Note不解释该语法。
* Library Validate：persistable valid时显示V4 valid；若runnable incomplete，附加unassigned count/paths但不标为invalid。
* Library Load：重读exact revision并经V4 persistable gateway创建fresh MacroRecord；unassigned原样保留，不Prepare、不Start。
* Prepare terminals：读取当前V4 visual/JSON buffer的合法terminalLayout；unassigned不产生layout entry，也不被解析。部分已指派layout仍可Prepare。
* Start：client与server必须同时要求persistable、runnable、Room ready、saved revision/controller/structure revision。任何unassigned零run install、零terminal mutation、零event log `run_started`。

`GET /api/templates`必须逐record扫描。每个current V4 record独立validate并生成summary；旧V3、invalid envelope或损坏JSON不读取、不迁移、不转换，只加入stable `invalidRecords: [{recordId,error}]`诊断。一个invalid record不得令整个List失败或清空其他valid summaries；显式Read该record仍按current schema fail loudly。Macro UI持续显示invalid record id/error，同时保留valid selector结果。旧用户文件通过明确删除清理，不增加legacy reader。

## 7. Runtime hard boundary

runner只接受runnable V4 snapshot。尽管Start已验证，Action execution仍对`kind:"unassigned"`做defensive fail loudly，绝不转换成empty string、terminal 1、none、skip或continue。

真实assigned artifact求值为`""`时按matcher/Send既有规则运行；它与unassigned完全不同。

## 8. Legacy kill list

实现完成后必须删除或不可达：

* `MacroDefinitionV3`、`schemaVersion:3` production reader/writer/fixture。
* Action/capture/lane primitive `terminalIndex` persisted field。
* 空`stepId`作为visual placeholder。
* Message artifact optional source。
* runner missing artifact source→`""`。
* `null`、`0`、empty string、missing property或magic scalar unassigned表示。
* generic `MaybeAssigned<T>`扩散及V3/V4 dual validation。

## 9. Gate

### Unit

* V4 exact schema、V3/legacy refs fail loudly。
* unassigned仅在白名单terminal/artifact slot可persist；其他位置拒绝。
* persistable ok/runnable incomplete分层与stable path/code/order。
* assigned invalid reference仍阻止Save。
* reference-driven layout忽略unassigned并在clear后裁剪tail。

### Integration

* Macro/Library API接受persistable unassigned V4并原样round-trip。
* Library Load生成fresh V4 MacroRecord，不Prepare。
* Start对unassigned返回stable issues，零run/terminal/event mutation。
* fully assigned V4继续Prepare/Start/Trace/runtime sync。
* List同时存在valid V4、V3 definition与损坏record时返回valid summary及逐record`invalidRecords`；显式Read V3仍失败，证明没有兼容reader。

### Browser E2E

* 空Room新增Send得到可选Unassigned、warning、Save成功、Start禁用。
* Room已有terminal时新增Send/Input/Capture/terminal-quiet Wait/Parallel lane仍默认Unassigned；用户显式选择后才形成layout。
* terminal创建后用户显式选择，warning消失、layout形成、Start可继续。
* 无论是否已有earlier artifact，新增If/Elif/Extract/message artifact part都默认Unassigned；matcher/scope/body仍可编辑并Save。
* 添加earlier producer并显式选择后runnable warning清零。
* assigned→Unassigned可主动清除。
* Library Macro JSON Validate/Save/Load保留unassigned并标明valid-but-incomplete。
* invalid saved record显示明确warning且valid saved Macro仍在selector中。
* 全部`.032-.036`current journeys按V4合理更新，非本task UI不得漂移。
