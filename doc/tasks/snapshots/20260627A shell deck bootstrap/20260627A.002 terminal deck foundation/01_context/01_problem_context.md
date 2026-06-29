# Problem Context

`orch-web` 已经证明 browser PTY、多客户端同步和真实 PTY smoke 可行，也通过 `20260616A.012 terminal input latency stabilization` 证明普通按键输入不能依赖 command-file append + helper polling。`shell-deck` 需要保留这些 terminal 底座经验，但必须把命名和模型切到 deck / terminal slot，而不是 role。

V0 的第一个风险不是宏逻辑，而是 terminal 像不像一个可靠 shell。如果输入延迟高、paste 被截断、输出 replay 丢失、两个浏览器 tab 状态不一致，用户不会信任后续宏自动化。因此第一阶段只解决 terminal deck。
