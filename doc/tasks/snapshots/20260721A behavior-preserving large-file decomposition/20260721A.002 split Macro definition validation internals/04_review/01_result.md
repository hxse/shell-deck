# Review Result

## 当前状态

`20260721A.002`实现与自审完成。`macroDefinitionValidation.ts`继续是MacroDefinitionV5 validation的唯一production facade；原JSON位置解析、issue/context、primitive、node递归和terminal/artifact reference helper已按职责移入内部模块。schema、合法输入、persistable/runnable分层、issue内容与顺序、JSON位置、UI/server/runner行为均未改变。

## 实际代码映射

* `src/lib/macro/macroValidationContext.ts`：承接公开issue code/type、validation context、issue收集/去重/排序和branch context/artifact state复制。
* `src/lib/macro/macroValidationPrimitives.ts`：承接exact-object、scalar/literal、identifier、template和regex检查。
* `src/lib/macro/macroNodeValidation.ts`：承接Action/Flow node递归和原有traversal顺序；没有重写node算法或另建schema模型。
* `src/lib/macro/macroReferenceValidation.ts`：承接terminal layout、terminal capability/Unassigned和earlier artifact reference helper；仍由原node traversal在相同位置调用。
* `src/lib/macro/macroJsonTextParser.ts`：承接原生JSON syntax offset与CR/LF/CRLF line/column标准化。
* `src/lib/macro/macroDefinitionValidation.ts`：保留原公共类型与函数导出，并按原顺序组合root/exact schema、layout、node/reference、persistable/runnable和JSON gateway。
* `tests/unit/macroDefinition034.test.ts`：新增一个multi-issue characterization，完整冻结value、runnable和JSON gateway的13项code/path/message/order。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：初版facade曾对terminal-layout JSON success type使用不必要的条件类型；自审时恢复为原始`MacroTerminalLayoutItem[]`，避免无意义抽象。另补multi-issue完整结果characterization。
* 需要用户拍板：无。

逐函数机械比对确认拆分前后55个function的签名与函数体一致；除跨模块调用必需的`export`外无差异，也无遗漏或新增function。issue code常量、公共result type和facade导出逐项保留。production import扫描确认UI、server与runner仍只消费`macroDefinitionValidation.ts`，内部依赖为facade/node/reference到primitive/context的单向关系，无反向依赖或第二套pipeline。

AgentEvent exact `waitLimit`、exact key、terminal layout连续性、terminal capability、earlier artifact、branch/lane context、Unassigned persistable/runnable、template/regex、issue去重/code-point排序及JSON offset/line/column均只移动原函数。没有V3 reader、legacy normalizer、migration、alias、第三方schema validator或Room state读取。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，193 modules transformed。
* `just test-unit`：拆分前baseline与拆分后均通过；最终154 unit与53 integration，0 fail。
* `just test-e2e`：最终完整重跑50项Chromium E2E全部通过，覆盖Macro V5 visual/JSON、Library、Unassigned和AgentEvent wait-limit journeys。第一次完整运行49项通过，唯一失败是范围外`roomLargeReplay032` long-history marker的20秒超时；未改代码或断言，完整复跑时该项及全套50项通过。
* `git diff --check`、内部import旁路、compatibility实现及`.orig/.rej`扫描：通过；`legacy`只出现在既有/新增的旧输入拒绝测试fixture中。

## 文档同步

本任务只改变内部源码归属，MacroDefinitionV5、validation和JSON contract没有变化，因此不改写`doc/tasks/active_specs/**`；本review与task index记录新的实现边界。
