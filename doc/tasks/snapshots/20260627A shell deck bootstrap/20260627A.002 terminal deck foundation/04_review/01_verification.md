# Verification

## Manual Smoke

2026-06-29 用户已对 `.002` terminal deck foundation 做基础人工验证，结论是“基本没问题”。本轮人工反馈覆盖了多 tab 同步、terminal tab 交互、fake terminal 输入可见性、tab 拖拽开关、active tab 可辨识度等 UX 路径；反馈发现的问题已在 `.002` change 中直接修复。

## Automated Gate

本轮 `.002` Close Gate 使用 just 入口验证：

```bash
just check
just build
just test-unit
just test-e2e
just test-002
git diff --check
```

已补充回归覆盖：

* Playwright e2e 使用动态端口，避免与 `just start` 的 5177 端口冲突。
* terminal tab 隔离：切换 tab 不复用旧 xterm 实例导致串屏。
* fake backend 由后端回显输入，仍不依赖前端 local echo。
* terminal alias rename、tab drag toggle、drag reorder、多 browser tab 同步。
* create terminal 失败和 alias 冲突不污染 config state。
* real PTY 覆盖 long paste、resize/stty、Ctrl-C 后继续可用、exit lifecycle。
