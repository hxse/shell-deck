# 20260722B.004 Legacy CSS Removal and Theme Closeout

## 任务概括

在`.001`至`.003`完成各自Code/Test Gate后，清除全项目剩余迁移前project-authored CSS、旧import和compatibility residue，冻结唯一framework entry，并以全部35个daisyUI explicit theme、`system` light/dark、1600/900/720 viewport及full current product journeys完成整体验收。最后把已落地truth同步到active specs。

## 正式 task 级别及定级原因

三星任务。

本change不承担大面积surface实现，但它是唯一可以宣称“旧CSS一行不留”和“全面迁移完成”的Gate owner。需要覆盖source residue、generated build、Theme catalog drift、全部theme几何、xterm live state和current full E2E，且必须防止用删测试或把旧rule挪到新入口伪造完成。

## 范围内

* 删除剩余`src/styles.css`、整个`src/styles/`、Svelte `<style>`和production旧import。
* 将`src/app.css`收敛为唯一project-authored framework source，并冻结其中允许内容。
* 添加`just ui-style-residue`及自动化source/build residue assertions。
* 执行36个Theme选择值，其中`system`分别覆盖light/dark effective appearance。
* 执行三viewport结构/几何/state矩阵、xterm retention和full current unit/integration/E2E。
* 新增current UI/theme active spec并同步browser settings、architecture、terminal、Macro和Library相关truth。

## 范围外

* 改变Theme selector位置或增加第二入口。
* 新增自定义theme、theme编辑器、账号同步、Room theme或per-terminal theme。
* 调整layout、control、文案、icon、interaction或业务schema。
* 用closeout修复未在`.001`至`.003`formal scope内的新产品问题；此类问题另建任务。
* 修改历史task snapshot或删除历史test evidence。

## 决策归属

AI可删除已被新framework完全替代的旧source、更新current tests/spec并修复Gate发现的迁移回归。若Gate暴露需要产品取舍的结构/行为变化，必须回到对应owner或请求用户决定，不能在closeout中自行设计。
