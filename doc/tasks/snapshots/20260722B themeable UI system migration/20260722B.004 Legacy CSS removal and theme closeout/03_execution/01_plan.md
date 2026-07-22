# Execution Plan

## 1. 审计前置与remaining source

* 核对`.001`至`.003`review和Gate均完成，无P1/P2及unknown mixed-selector handoff。
* 枚举所有`src/**/*.css`、Svelte `<style>`、CSS import、production color literal和current style tests。
* 将每个remaining item分为delete、framework allowlist或xterm palette allowlist，未知项不得跳过。

## 2. 清除legacy并固化Gate

* 删除剩余旧file/import/style block，收敛`src/app.css`到formal allowlist。
* 实现可单测residue scanner并通过`just ui-style-residue`暴露，接入`just check`。
* 从current test/command入口清除deleted-path/cascade oracle引用；消费`20260722A.002`稳定per-file fixture，精确allowlist App Theme四element增量，其余结构逐文件exact比较。

## 3. 执行全theme/viewport matrix

* 遍历35个explicit theme × 3 viewport及system light/dark × 3 viewport。
* 在stable populated Home/Room/Macro/Library/terminal/notice状态收集DOM fingerprint、overflow、critical geometry和semantic computed state；补测六个inclusive max-width精确边界。
* 对representative theme补视觉assertion，修复发现的fixed-light、density、focus、readonly和current-state问题，不改变结构。

## 4. 执行terminal与full regression

* 回归xterm explicit/system switch、non-bottom scrollback、bottom follow、resize、selection和continued real PTY output。
* 执行`just check`、`just build`、full current unit/integration/E2E、residue和diff Gate。
* 失败项回到对应presentation owner做最小修复；独立业务bug记录为新task，不夹带。

## 5. 同步真值与收口

* 新建UI Theme active spec并同步受影响current specs。
* 更新root/children index和review，记录dependency版本、CSS manifest、matrix数量、command result及P1/P2/P3。
* 只有全部Gate真实通过后标记`.004`和`20260722B`完成。
