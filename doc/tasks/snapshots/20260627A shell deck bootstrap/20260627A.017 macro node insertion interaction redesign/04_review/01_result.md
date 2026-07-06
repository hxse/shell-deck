# Review Result

状态：implementation-landed；automated gate passed。

设计结论已落地：Macro editor 改为 node-local insertion anchor + floating insertion palette。常驻右侧 Actions/Flow 栏已从主路径移除；runner controls 移到 Macro run dock / status bar。

实现摘要：

* 新增 path-based Flow V2 editor command 层，支持 before / after / inside if/elif/else/for 插入、同 body move、remove、elif/else 创建。
* 每个节点 header 提供 Add before / Add after / Move up / Move down / Remove。
* if / elif / else / for 提供局部 Add inside 入口；finish 在 root/body palette 中可见，用于显式结束和调试；break / continue 只在 for scope 的 floating palette 中出现。
* `for` 支持 `count` / `forever` 两种 range；`forever` 通过 `break` / `finish` / stop / fail 退出。
* `finish` / `break` / `continue` 支持 action-only body，运行时先执行 body 内普通 action，再触发对应控制流；编辑器和 validator 均拒绝把 flow node 插入其中。
* 导入模板里的 `finish` / `break` / `continue` 即使缺少可选 body，空 action body 的 Add inside 也会在真正插入时创建 body；插入失败时 palette 保持打开并显示 notice。
* `extract_text.onEmpty` 新增 `continue`，在 `for` 内空结果时跳过本轮后续 action。
* Terminal target 下拉合并为一行一个 terminal，同时显示 index/alias/id，并用 hover title 暴露完整映射；已有 alias/index/id target 通过实时 `indexMap` 映射回当前 terminal 行。
* Macro 顶栏新增 insertion palette placement 开关，默认 `near`，可切换 `center`；`near` 模式根据触发按钮所在上下半屏显示在按钮下方或上方，并按实际 palette 尺寸 clamp 到 viewport 内，且不覆盖触发按钮或 node header。
* Floating insertion palette 新增 `Move existing`，支持选择已有 node id 并移动到当前 anchor；命令层拒绝把节点移进自己的子树，也拒绝移动到自己前后这种 no-op 位置；anchor 记录原目标 node id，anchor validity check 保持只读，远端变更导致 target stale 时自动关闭并提示。
* Palette 打开后焦点进入第一个可操作控件；Esc/Cancel 后焦点返回触发按钮。
* Flow editor 增加 Py-like scope guide / branch card / empty body add affordance，并给每个节点 header 增加视觉折叠/展开按钮，不改变模板语义。
* Validation 面板移到 editor 顶部，默认一行摘要；成功显示 success，失败显示首个 issue 摘要，展开后显示完整 issues。
* Macro run dock 将 `Pause` 和 `Resume` 合并为一个状态感知按钮：`paused`/`waiting`/`interrupted` 时显示 Resume；`waiting_user_input` 时显示 Pause，输入完成由 input box 的 Send 触发；`running` 时显示 Pause；非 live 状态禁用。
* JSON view 的 preview 区域撑开到可用高度，不再只按内容高度收缩。
* 默认 `just start` seed 调整为两个 `real` shell terminal 加一个 `text` deck slot；显式 `--seed-backend` 仍保留测试/兼容用途。
* 空 body、空 message parts、artifact source none、`extract_text.select` 的 `all`/`index`/`range` 收口正式纳入 .017 scope；`send_line` 新建默认 message parts 为空；artifact part 的 `none` 不再保存空 stepId，validator/runner 将其视为空字符串。
* `extract_text.select` 移除 `first/last` 独立 mode，改用 `index` / `range`，并支持负数索引。
* Side panel 拖拽范围扩大到 `220..1200px`，桌面 CSS 最大宽度放宽到 `85vw`。
* .017 focused Playwright 覆盖插入、取消、remove confirm、for-scope palette、control-terminal action-only palette、节点折叠、Validation success、JSON preview 高度、JSON path 结果。

边界保持：未恢复旧 v1 flow；未改 Template selector / Prompt panel / Trace tab / terminal tabs 语义。
