# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* `validateMacroDefinitionV5`、`validateRunnableMacroDefinitionV5`和`parseAndValidateMacroDefinitionJson`的导出、输入与返回冻结。
* AgentEvent `waitLimit`的exact unbounded/timeout branch、issue path与验证顺序冻结。
* exact schema、unknown-field、current-schema-only hard cut和合法输入集合冻结。
* 每个issue的code、path、message、排序与重复消除规则冻结。
* invalid JSON的offset/line/column和invalid definition的分层冻结。
* terminal/artifact earlier、scope、capability、Unassigned与runnable completeness行为冻结。

### Primary file

`src/lib/macro/macroDefinitionValidation.ts`。

## 任务规范

### 目标模块

* `macroValidationContext.ts`：path stack、stable issue collector与deterministic traversal context。
* `macroValidationPrimitives.ts`：exact object、string/number/enum、template/regex等无跨节点primitive检查。
* `macroNodeValidation.ts`：Action与Flow node结构递归，不负责跨节点可达性。
* `macroReferenceValidation.ts`：terminal layout、earlier artifact、branch/lane scope与runnable Unassigned pass。
* `macroJsonTextParser.ts`：原生JSON解析位置标准化，并调用public value pipeline。
* `macroDefinitionValidation.ts`：导出facade、pipeline顺序与公共result types。

最终命名可微调，但public facade文件与职责必须保留。

### Pipeline

1. JSON入口只负责parse；成功后进入同一value validator。
2. persistable pipeline先做root/exact schema，再递归node结构，最后做layout/reference/global constraints。
3. runnable pipeline必须先取得persistable success，再只追加runnable completeness issues。
4. collector按原traversal产生稳定issue；不得在末尾用新排序掩盖遍历变化，除非当前实现本就如此。

### 依赖方向

`facade/text parser -> node/reference -> primitives/context`。primitive与context不得依赖node/reference；内部模块不得被UI/server绕过facade直接组成另一套pipeline。

## 示例

### 等价输入

同一个含多个Unassigned、future artifact和unknown field的definition，拆分前后必须产生完全相同的issues数组，包括顺序和path。

### 非法实现

* 用第三方schema validator替换现有逻辑，导致message或path改变。
* UI直接调用`macroNodeValidation`而跳过global reference pass。
* JSON parse错误直接透传不同runtime的原始message。
* 为方便测试导出并长期消费内部半成品validator。

## 测试

### Characterization

* 为每种Flow/Action、exact key、terminal/artifact reference和Unassigned建立snapshot-free明确断言。
* 对multi-issue definition断言完整code/path/message/order。
* 对JSON syntax error断言offset/line/column。

### Boundary

* public facade仍是production consumer唯一入口。
* value validation与JSON text validation对同一parsed value返回一致issues。
* runnable不重复persistable issue，也不读取Room state。

### Gate

运行Macro definition unit、Macro/Library API integration、visual/JSON E2E、`just check`、`just build`与`git diff --check`。扫描不得出现V3、legacy normalizer或第二套pipeline。
