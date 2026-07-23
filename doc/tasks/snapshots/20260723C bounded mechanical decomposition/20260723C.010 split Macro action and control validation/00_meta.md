# 20260723C.010 Split Macro Action and Control Validation

## 任务概括

`src/lib/macro/macroNodeValidation.ts`当前445行，在同一dispatcher中实现全部Action、Parallel、If/For和terminal control validator；对应`macroDefinition034.test.ts`为510行。本task按action/control domain拆源码与测试，不改变任何issue。

## 正式 task 级别及定级原因

三星任务。validator输出是public persistence/Start contract；issue不仅包含内容，还要求stable path与顺序。普通函数移动若改变遍历或`add()`时点，就会让多错误输入产生不同结果。

## 范围内

* 新建Action validator模块。
* 新建Control/Parallel validator模块。
* `macroNodeValidation.ts`保留`validateNodeList`与唯一node dispatch facade。
* 按validation domain拆`macroDefinition034.test.ts`，case/title/assertion完全保留。

## 范围外

* 不改变MacroDefinitionV5、issue code/message、persistable/runnable边界或JSON parser。
* 不增加schema alias/default/migration。
* 不合并、删减或参数化测试来降低assertion数量。
