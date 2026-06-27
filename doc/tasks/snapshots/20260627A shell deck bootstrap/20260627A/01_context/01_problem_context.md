# Problem Context

## 使用场景

用户需要在浏览器里同时操作多个本机 terminal。某些 terminal 里可能跑 Codex，某些 terminal 里可能跑 shell command、test watcher、debug server 或其它 TUI。用户希望把常见重复流程写成宏，例如“让一个 terminal 审查，再把可直接修的问题发给另一个 terminal，必要时暂停等人工输入”，但不希望系统把这些终端强行包装成固定 role。

真实工作流通常不是一个后台 loop 从头跑到尾。中途经常会出现 parser 不确定、Codex 输出偏离、需要人工拍板、命令卡住、用户想改提示词、想换一个 terminal 继续、或者干脆退出 Codex 改跑 shell 命令的情况。因此系统必须优先支持可暂停、可追溯、可人工接管，而不是追求全自动 orchestration。

## 需求痛点

`orch-web` 已经证明 browser PTY、多客户端同步、真实 shell PTY、Codex TUI smoke 和输入延迟优化是可行的。但它后续走向 role / sealed instruction / hook wait collect / blocking operation API 后，控制权越来越偏向后台 state machine。role 负责 loop 时容易出现几个问题：

* role 语义不稳定，实际输出和预设职责经常不一致。
* 后台 loop 可视化困难，用户难以知道系统为什么继续、暂停或跳分支。
* Codex session、hook、role state 和 artifact 强耦合后，任何第三方变化都会放大复杂度。
* 用户临时接管或换流程时，固定 role workflow 反而碍事。

新项目需要保留 browser terminal 的优势，但把自动化边界切到 macro 层：宏只编排 terminal，不拥有 terminal 里的语义。

## AGENTS 工作流背景

`pyo3-quant/AGENTS.md` 代表了一套严格 AI 协作工作流：先写 spec，按 task Gate 推进，审阅按 P1/P2/P3 分级，区分 AI 可直接修和需要人工拍板，并把验证结果写回 task。`shell-deck` 的目标不是泛用自动化玩具，而是把这套 spec/review/Gate 工作流工程化：让用户在多个 terminal 和 Codex 会话之间保留控制权，同时把宏执行、parser 判断、暂停点和审阅证据记录成同一份可追溯日志。

因此 V0 的设计优先级是“可审、可暂停、可恢复、可被 AI 追溯”，而不是最大化后台自动 loop。

## 设计初衷

`shell-deck` 要成为 terminal-first macro automation 工作台。它承认 terminal 里的程序是不确定的，承认 AI 输出不适合作为强 contract，也承认用户需要随时中断自动化。因此系统提供的是可视化宏、输出解析、分支、暂停和日志，而不是替用户隐藏决策。

宏模板底层是 JSON，方便导入、导出、备份和 AI 生成；但用户主要通过浏览器侧面板做增删查改。宏执行过程的每一步都写入同一份 append-only event log。可视化节点展开看到的内容和 AI 读取的追溯日志必须来自同一份真值，不能出现 UI 一套状态、AI 一套日志。

## 候选方案

第一种方案是继续 `orch-web` role 路线，把 coder、reviewer、validator 等固定 role 搬到新项目。这条路短期看起来能复用更多代码，但会把新项目重新绑回 Codex orchestration，违背“用户灵活把握”的核心目标。

第二种方案是只做一个 Web terminal 加手写脚本。它简单，但没有可视化 macro panel、没有 parser、没有 event log，也不能沉淀可复用流程。

第三种方案是 terminal deck 加 macro runner。terminal 可以用动态编号、alias 或稳定 terminal id 标识；宏模板对 resolved terminalId 写入、等待 agent output、解析 signals 和分支。Codex 可以出现在 terminal 里，但系统不接管它。这条路保留了自动化，又把控制权留给用户。

## 取舍结论

V0 选择第三种方案。它复用 `orch-web` 的 terminal 底座和输入性能经验，但从命名、数据模型和文档上切断 role / Codex orchestration。V0 持久化 macro template、macro run event log 和 macro state；不绑定 Codex session。恢复时如果 PTY 还在，用户可以继续；如果 PTY 已丢，用户可以自己 `codex resume` 或重新启动程序，再从宏的暂停点继续。
