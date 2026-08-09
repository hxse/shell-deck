# Execution plan

## 阶段一：恢复cwd contract

* Just recipe用`invocation_directory()`传入专用target cwd。
* TypeScript wrapper在spawn边界设置child cwd/PWD，保留hook path、runtime context与Codex args。
* 用fake Codex通过真实Just recipe冻结回归，不修改`~/nixos-config` wrapper。

## 阶段二：增加局部Capture guidance

* 在`CaptureSourceEditor.svelte` AgentEvent分支中增加唯一command constant、clipboard state和copy handler。
* root/Parallel共用同一份DaisyUI alert与markup，命令始终可见/可选择，不增加CSS或definition扫描。
* 增加focused browser regression，覆盖显示、exact clipboard value与failure feedback。

## 阶段三：真值与验收

* 同步Capture active spec、architecture、Quickstart、README与task index。
* 串行运行focused与完整Gate，检查warning、file-size和diff。
* 以代码+文档侦探式post-review核对cwd/env边界、clipboard failure、root/Parallel一致性和旧行为保留。

## 文件与停止线

不新建generic clipboard helper，因为当前command和structured prompt的UI/feedback形态不同，共享抽象不会减少真实复杂度。不修改Codex/Serena global wrapper、AgentEvent runtime或Macro schema。停focused/full Gate全绿、无P1/P2且current docs一致时结束。

## 验证顺序

所有命令严格串行：

1. `just check`
2. `just build`
3. `just test-unit`
4. `just test-integration`
5. `just test-20260809a`
6. `just test-e2e`
7. `just diff-check`
