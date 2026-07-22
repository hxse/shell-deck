# 20260722A.002 Terminal Live-output Scrollback Retention

## 任务概括

Shell terminal在Codex TUI等持续刷新场景中，用户拖动scrollbar向上查看历史后，会在下一次browser render update完成时瞬间回到底部。修复目标是恢复标准terminal follow-output语义：原本位于底部时继续跟随，用户主动离开底部后保留历史viewport。

## 正式 task 级别及定级原因

二星任务。

问题集中在既有xterm owner及其browser journey，不改server/runtime协议；但必须同时守住initial hydration、live append、resize/reflow和长期高频输出，避免修复scrollback后让新terminal停在历史顶部。

## 范围内

* 移除live append完成后的无条件`scrollToBottom()`。
* resize只在resize前已位于底部时显式恢复bottom follow。
* initial/replacement hydration完成后仍落在底部。
* 增加真实xterm browser regression，覆盖向上滚动期间的新输出与重新回到底部后的follow恢复。

## 范围外

* 不修改Codex、shell或PTY输出内容。
* 不增加自定义scroll lock按钮、偏好设置或持久化viewport。
* 不改变server replay tail、browser replay上限、parser pump或terminal tab retention。
* 不改变Text terminal textarea scroll行为。

## 决策归属

人工已要求直接修复，并允许归入`.001`或`.002`。该问题属于独立terminal viewport owner，因此由AI放入`.002`，避免回写已经Close Gate的`.001`。
