# Problem Context

## 当前style ownership

基线的App/Room/terminal presentation主要散布在`src/styles/base.css`、`room.css`、`terminal.css`和`workspace-panels.css`。这些文件并非按component严格分层：例如terminal stylesheet同时包含global form和Macro基础rule，workspace stylesheet同时包含topbar、xterm host和side panel。实施时必须按实际selector consumer迁移，不能仅按文件名整块删除。

对应Svelte owner为：

* `src/App.svelte`：Room shell、topbar、controller status、Settings和全局notice接线。
* `RoomHome.svelte`：Home header、Room list、empty state。
* `WorkspaceShell.svelte`、`TerminalTabBar.svelte`：full-height workspace、side panels、resizer和tabs。
* `TerminalSlot.svelte`：xterm lifecycle、metadata和host；当前直接import xterm vendor CSS并使用固定`#111316/#e6edf3`theme。
* `TextBoxSlot.svelte`：Text terminal editor、line-number gutter和scroll synchronization。
* `NoticeStack.svelte`：fixed dismiss layer、toast placement和semantic notice state。

## 为什么terminal需要独立bridge

daisyUI theme token由CSS custom properties驱动，xterm foreground/background/ANSI colors则通过JavaScript option消费。仅改变terminal host background会让canvas glyph、selection和ANSI output继续使用旧palette；为每个theme建立完整ANSI palette又会引入35份难以审阅的视觉数据。本任务采用一组light和一组dark ANSI palette，并依据effective theme的明暗metadata选择。

## Live state风险

`TerminalSlot`在mount时创建xterm，随后持续接收output、保存view state并处理resize。`20260722A.002`刚冻结了用户向上滚动时live output不得强制回到底部。Theme change若dispose/recreate terminal或调用clear/reset，就会绕过该修复，因此必须对同一instance原位更新option并新增真实scrollback回归。

## Layout风险

current UI依赖多层`min-width/min-height: 0`、flex shrink、absolute xterm inset、overflow owner和固定compact heights。daisyUI默认padding/height不是这些geometry的替代品。迁移可以改变视觉语言，但需要用明确utility保持current measurable layout；父CSS的`max-width`边界是inclusive，640/680/980/1100/1260px本身都必须进入窄侧规则，不能用Tailwind exclusive `max-[Npx]`改变边界语义。1600px、900px和720px主矩阵之外还要精确验证这些边界。

## 分阶段residue

部分物理CSS文件仍包含`.003`的Macro/Library consumer。本change可以删除已完全失去consumer的file；对混合文件只能移除已迁移selectors，并在review登记剩余selector及其`.003`owner。不得把旧rule复制到新的compatibility CSS来制造文件级“完成”。
