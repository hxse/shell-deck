# Quickstart

`shell-deck` V0 还没有完整可运行产品，但 `.001 v0 api probe` 已经落地并通过。当前可以运行 API probe，验证后续 `.002` / `.006` 会依赖的 terminal deck baseline 和 Codex hook baseline。

```bash
just test-001-offline
just test-001-online
```

`test-001-offline` 不访问网络、不调用真实模型；`test-001-online` 会调用真实 Codex CLI，可能使用网络、认证和模型额度。完整 dev server、browser terminal deck 和 macro panel 会在后续子任务补齐。

当前阅读入口：

```text
doc/tasks/index/001_20260627A.md
doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A/02_spec/01_contract.md
doc/tasks/snapshots/20260627A shell deck bootstrap/20260627A.001 v0 api probe/04_review/02_verification.md
```
