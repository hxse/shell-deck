# 20260627A.007 Parser Profiles And Adapters

## 任务概括

交付 parser adapter interface、`regex` parser、`ai-json`/`codex exec` one-shot Spark probe、mock parser、内置 ParserProfile bundle、schema validation、normalize、soft signals、replicas disagreement pause 和 fixture eval。完成后，宏可以把 capture artifact 解析成结构化分支信号。

## 正式 task 级别及定级原因

三星任务。

AI parser 是 V0 最大不确定性来源。必须用 profile bundle、schema、fixtures、replicas 策略和 pause 机制把不确定性显式暴露给用户；regex parser 则提供确定性的本地匹配选项。两者都不能伪装成系统审计真值。

## 范围内

* parser adapter interface。
* mock parser。
* `regex` parser adapter。
* `codex exec` one-shot `ai-json` parser adapter probe。
* 可选 online `ai-json` adapter smoke。
* 内置 ParserProfile bundle：prompt、JSON Schema、typed signals、checkSet、fixtures。
* `true/false/null` signals 和 `claims*` 字段规范。
* replicas=2 的 `agree_or_pause`。
* parser fixture eval。

## 范围外

* 不实现 capture source adapter。
* 不做 V0 quickstart/active spec 收口。
* 不把 parser 当 command/file audit 真值。
* 不支持用户自定义 parser prompt。
