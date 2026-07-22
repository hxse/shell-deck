# 20260722A Shell-deck Bug Fix Series

## 任务概括

在`20260721A.010`完成结构拆分与current test closeout后的产品状态上，建立一条只处理真实bug、误导交互和缺失反馈的修复链。每个可独立验收的问题批次使用一个正式子任务和一个jj change，避免把后续功能、重构或历史任务修订混进同一change。

## 正式 task 级别及定级原因

三星任务。

该系列会按子任务触及Macro schema、runner/browser消息、Svelte editor状态、CSS与自动化测试。单个修复可以局部，但必须持续守住current-schema-only、server-authoritative Room/runner和saved record边界，因此根任务需要完整Document/Code/Test Gate规则。

## 范围内

* 记录并修复可由源码、测试或用户操作稳定复现的产品问题。
* 每个子任务冻结Added/Frozen Semantics、primary files、负向边界和回归Gate。
* 对需要改变current contract的修复直接更新唯一schema/spec与全部current consumer，不增加legacy分支。
* 修复完成后同步对应active spec与task index。

## 范围外

* 以bug修复为名进行无关架构重写、UI全面改版或generic framework抽取。
* 添加alias、migration、旧schema reader、dual contract或自动转换。
* 回写已经冻结的历史task snapshot来伪造原设计。
* 改变未被当前子任务列入范围的Room、terminal、Library、storage或runner语义。

## 决策归属

人工已拍板：创建`20260722A`作为bug-fix系列，首批问题全部放入`.001`。AI可按子任务formal spec直接实施、自审并修复明显问题；出现需要新产品方向或跨域权限的内容必须另行记录，不得自行扩张。
