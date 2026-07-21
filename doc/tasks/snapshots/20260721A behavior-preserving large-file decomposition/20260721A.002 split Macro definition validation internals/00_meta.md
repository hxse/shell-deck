# 20260721A.002 Split Macro Definition Validation Internals

## 任务概括

把`src/lib/macro/macroDefinitionValidation.ts`按JSON text gateway、validation context、primitive字段、Flow node和跨节点reference检查拆开。原文件继续是MacroDefinitionV5唯一公开验证入口，所有consumer无需理解内部模块。

## 正式 task 级别及定级原因

二星任务。

主体是pure deterministic logic，但issue code/path/order、persistable与runnable分层、JSON位置和earlier/scope判断都是公开contract。拆分需要精确characterization，不允许用“同样报错”替代byte-level稳定性。

## 范围内

* 抽取validation context与issue collector。
* 抽取primitive/exact-object、Flow node和reference validators。
* 抽取JSON parse/position gateway。
* 保留原导出函数与类型作为唯一public facade。

## 范围外

* 不改变MacroDefinitionV5结构、AgentEvent exact wait-limit、合法输入集合或validation顺序。
* 不新增V3 reader、migration、alias或宽松parse。
* 不修改visual editor、server store、runner与Library业务。
* 不引入schema library替换现有validator。
