# Verification

状态：pass。

已运行命令：

```bash
just check
just test-013
just test-unit
just test-e2e
git diff --check
```

当前结果：

* `just check`: 0 errors / 0 warnings。
* `just test-013`: 6 unit pass + 6 Playwright pass。
* `just test-unit`: 129 pass。
* `just test-e2e`: 21 pass, 1 Codex online-only skipped。
* `git diff --check`: pass。

覆盖点：

* UiLayoutStore 默认值、宽度 clamp、config-scoped persistence、非法 config id 拒绝。
* PromptStore project/global CRUD、scope list、scope migration、id collision guard、title/body/tag search、update/delete、config isolation、非法 id/path 拒绝。
* GUI: Macro 默认可见，Prompt 默认隐藏。
* GUI: Prompt toggle 显示、reload 后持久化、同 config 第二 tab 同步。
* GUI: Prompt panel resize、reload 后保持、Reset width 恢复默认。
* GUI: Macro panel visible toggle、width resize、Reset width 同步到第二 tab。
* GUI: project prompt 新建、搜索 title/body/tag、preview、copy body。
* GUI: global prompt 新建、scope filter、编辑保存、delete confirm cancel/accept；未保存 scope change 后 Delete 仍删除已保存 selected scope，不误删同名另一个 scope。
* GUI: 已保存 prompt 可从 project 迁移到 global，旧 project 列表移除，新 global 列表可见；当前 filter 隐藏目标 scope 时保存后自动切到目标 scope；非 local config 下 global→project 回迁会落到当前 config。
* GUI: global prompt 跨 config 广播，另一个 config tab 自动刷新。
* GUI: 非 dirty selected prompt 收到远端更新会自动刷新正文，并只在收到显式 moved 事件后跟随新 scope；project/global 存在同名 promptId 时仍按 selected scope 精确刷新；远端删除 selected prompt 不会误切到同名另一个 scope；dirty draft 保留本地草稿并提示冲突。
* GUI: 1080px 窄桌面宽度下 Macro + Prompt 双侧栏仍完整落在 viewport 内，terminal deck 保持可用宽度。
