# 场景、问题与取舍

## 使用场景

用户在一个shell-deck Shell里运行Codex。Macro先用`send`要求Codex完成判断并给出结构化结果，随后等待结果中的`decision`、`confidence`等字段，再用`if`选择下一条流程；某些流程还需要把整份已验证JSON原样作为JSON文本再次Send给Codex或其他terminal程序。

现有Codex Stop hook只能观察`last_assistant_message`。即使提示词要求输出JSON，模型仍可能附加Markdown、解释或其他文本；原Capture产物和If也都只有text，因此无法把“字段存在、类型正确、值符合枚举”变成runner正式保证。反过来，若typed JSON只能进入`json_match`，它又会成为无法再次Send、Notify、预填Input或Extract的死端，迫使用户复制第二份text真值。

## 设计目标

保证不是来自“模型看起来像JSON的回复”，而是来自terminal内程序显式调用的提交协议。协议应保持terminal-first：shell-deck不调用或绑定Codex API，Codex只是可能执行该命令的程序之一。

不同Room同时运行时不得串结果。正常使用是一条Send后等待一次正确提交，因此不引入step ID、per-step token或通用消息路由；与现有Stop hook一样，关联重点是当前Room generation和frozen terminal launch。

JSON Schema与提交命令分处Capture和Send时，用户容易遗漏stdin、成功码或重试规则。Visual editor因此需要从当前合法Schema生成一段可查看的建议提示词，但不能猜测它应写入哪一个Send。clipboard只是快捷路径；浏览器拒绝权限时，完整提示词仍必须保持可见、可选择并允许用户手动复制。

## 方案比较

新增端口或文件轮询会复制现有server、认证、生命周期和清理机制，并产生stale file与跨Room归属问题，不采用。

把structured JSON伪装成Codex Stop AgentEvent会把显式提交和被动hook观察混成同一事件语义，也会把能力不必要地绑定Codex，不采用。

最终方案是在现有HTTP server增加专用structured-result ingest，继续使用Shell启动时注入的URL、token、Room generation、terminalId和launchId。Shell还注入当前checkout canonical justfile路径，使提示词可以从任意terminal cwd定位recipe而不冻结开发机绝对路径。`just submit-json`不接受identity参数，只读取当前terminal环境；server只把提交交给该terminal当前唯一active structured Capture。

## 取舍结论

不使用step ID意味着同一terminal不能同时等待两个structured Capture。本任务通过root runner顺序执行和“每个terminal至多一个active waiter”收口，不建立submission queue。没有active waiter时命令fail loudly；合法提交消费一次后waiter立即退出。

结构规范不发明私有DSL，采用JSON Schema 2020-12。字段读取采用JSON Pointer，条件比较保持typed；`"1"`与`1`不相等，缺失字段不会被`not_equals`误判为成功。

JSON artifact仍只保存一份typed value。需要文本的既有consumer在读取边界使用同一canonical compact projection，而不是让Capture双写`captured_text`：object key递归稳定排序、数组顺序不变、scalar类型保留、无格式化换行，Send的Ending sequence仍是唯一提交边界。Parallel final Output只有lane-local text producer，因此不人为扩大其source family。
