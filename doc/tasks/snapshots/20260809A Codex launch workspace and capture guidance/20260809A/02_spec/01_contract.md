# Codex launch workspace and capture guidance contract

## 任务边界

本任务恢复既有的Codex caller-workspace contract，并增加纯authoring guidance。它不修改AgentEvent格式、ingest identity、hook payload、Capture artifact、waitLimit、MacroDefinitionV6或runner行为。

UI不读取或暴露server上的absolute checkout path，不自动修改Send或终端内容，不自动启动Codex，不申请新的browser权限。

## 任务规范

### Caller workspace

`codex` recipe必须用Just原生`invocation_directory()`捕获用户发起命令的目录，并以`SHELL_DECK_TARGET_CWD`传入`scripts/shell-deck-codex.ts`。wrapper必须将Codex child的OS cwd与`PWD`都设为该目录。

hook script仍从shell-deck checkout的module URL解析；Room/terminal/launch/ingest context仍只从Shell注入环境继承。调用目录不改变User Data Root、hook identity或evidence存储归属。

所有Codex CLI参数必须原样透传。用户显式传入Codex原生`-C/--cd`时，下游Codex/Serena wrapper继续按原生规则处理该override；shell-deck不删除、重写或追加第二个`--cd`。

### Capture guidance

当且仅当Capture的`kind`为`agent-event`且agent为`codex`时，root和Parallel Capture editor都显示同一条单行、紧凑、theme-native的command bar。提示必须：

* 使用`Codex` badge标识用途，正常状态总高度为32px且不换行；
* 始终显示并允许手工选择exact command：`just -f "$SHELL_DECK_JUSTFILE" codex`；
* 命令区可以横向滚动，不能通过截断或换行隐藏命令正文；
* 悬浮命令区时使用daisyUI tooltip解释应在所选Shell运行，且该Shell当前目录会成为Codex workspace；
* 提供`Copy`按钮，悬浮时解释它会复制Codex启动命令，成功后显示`Copied`；
* clipboard失败时才在command bar下方显示明确的manual-copy提示，命令本文仍保持可见。

该命令不带Room、terminal、launch或step id；它从所选shell-deck Shell继承现有runtime context。当Capture kind切回terminal-buffer/text-box/structured-json时，该提示不显示。

## 示例

用户在shell-deck的Shell中先进入目标项目：

```bash
cd ~/dev/pyo3-quant
just -f "$SHELL_DECK_JUSTFILE" codex
```

Codex默认workspace必须是`~/dev/pyo3-quant`，不是`SHELL_DECK_JUSTFILE`所在的shell-deck checkout。

如果用户需要显式选择其他workspace，原生参数仍可以透传：

```bash
just -f "$SHELL_DECK_JUSTFILE" codex -C ~/dev/another-project
```

在Macro中将Capture kind切换为`agent-event`后，编辑器显示上述第一条Codex启动命令和复制按钮。复制被browser拒绝时，用户仍可以选中可见命令手工复制。

## 测试

Code/Test Gate至少覆盖：

* 从非shell-deck临时目录执行真实`just -f <shell-deck>/justfile codex`，fake Codex观测到的cwd/PWD都是调用目录；
* 缺少Room context仍在启动Codex前fail loudly；
* 非AgentEvent Capture不显示指导，root/Parallel Codex AgentEvent Capture都显示exact command；
* Copy写入exact command，成功和clipboard failure都有可见feedback；
* 现有AgentEvent wait-limit、structured JSON prompt和Macro authoring regression不变。

focused入口为`just test-20260809a`。Close Gate严格串行执行`just check`、`just build`、`just test-unit`、`just test-integration`、`just test-20260809a`、`just test-e2e`与`just diff-check`。任何warning/error、P1/P2、conflict或超过400行的project-authored code都阻断完成。
