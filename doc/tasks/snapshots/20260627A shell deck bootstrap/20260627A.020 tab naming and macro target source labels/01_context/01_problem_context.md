# Problem Context

Shell-deck 已经同时支持 shell/fake/real backend 和 `backend = text` 的文本 tab。继续把默认 alias 统一命名为 `terminal_N` 会让用户误以为 text tab 也是 shell terminal，也会让 macro 面板里的 `Terminal` 标签在 send/capture/input 等不同语义下变得含糊。

当前约束是：底层协议和 macro JSON 已稳定使用 `terminal` 字段表达 index/id/alias ref。本任务只做用户可见命名清理，不做 schema 迁移。

## Design Intent

* 默认 tab alias 反映 backend 类别：shell/fake/real 都是 `shell_N`，text backend 是 `text_N`。
* 用户在宏编辑器里选择的是 deck tab，不是只能选择 terminal process。
* send/input/wait 选择目标时显示 `Target tab`；capture 选择来源时显示 `Source tab`；parallel lane 选择 lane 绑定对象时显示 `Lane tab`。
* JSON、run log、server event kind 中已有 `terminal_*` 协议名不在本任务修改范围内。
