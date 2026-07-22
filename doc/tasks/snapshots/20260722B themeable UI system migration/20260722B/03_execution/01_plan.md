# Execution Plan

## 阶段一：`.001`建立foundation

1. 安装并锁定Tailwind CSS 4、Vite integration与daisyUI 5，建立新的framework entry。
2. 冻结35个内置theme catalog及`system`，升级browser settings exact schema，在stylesheet与application module前注入同步head bootstrap，并由`main.ts`在mount前复核。
3. 只在Room现有Settings加入紧凑Theme selector，建立semantic state、compact density和static class规则。
4. 用focused test证明Theme选择、持久化、OS跟随、invalid value和无Room mutation。

## 阶段二：`.002`迁移App/Room/terminal

1. 按style owner迁移Home、App shell、Room chrome、workspace、terminal tab/slot、text box与notice。
2. 每完成一个owner即删除对应旧rule/import，避免同一surface长期双owner。
3. 建立light/dark xterm ANSI bridge并验证原位theme更新不会影响live terminal状态。
4. 在desktop/compact/narrow viewport回归现有布局、resizer、overflow与scroll owner，并精确覆盖inclusive 640/680/980/1100/1260px边界。

## 阶段三：`.003`迁移Macro/Library workbench

1. 迁移Macro chrome、editor、flow、trace、run dock及shared responsive style。
2. 迁移Library search/list/editor/session surface并保留现有control顺序和edit lease UI语义。
3. 重点冻结nested flow、insertion control、template token、running/readonly/disabled/current stage和窄viewport geometry。
4. 从`20260722A.002`父revision生成稳定per-file structure fixture，逐文件验证exact delta，并覆盖inclusive 760px边界。

## 阶段四：`.004`清零与closeout

1. 删除剩余`src/styles.css`、`src/styles/**`、component `<style>`和旧import，不保留compatibility stylesheet。
2. 将current style tests从旧file/cascade oracle切换到framework、structure、geometry和semantic-state oracle，历史snapshot保持不改。
3. 遍历35个explicit theme与`system`，覆盖1600px、900px、720px和关键产品状态。
4. 执行full check/build/unit/integration/E2E、terminal retention、residue和diff Gate；同步current active specs与task index。

## 每个子任务的收口规则

* 一个子任务对应一个顺序jj change，只有formal ownership内的source/test/doc可修改。
* 迁移前后对照UI structure inventory；任何非Theme selector结构差异先判定为越界，不以“library要求”为理由接受。
* 自审按P1/P2/P3记录；未解决P1/P2不得进入下一change，P3必须明确修复或延期归属。
