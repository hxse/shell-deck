# Execution Plan

## 阶段一：状态图

列出selection、draft、JSON buffer、edit lease、pending operation、preservation、invalidation和runner projection的owner及转换。为每个await记录捕获identity与commit guard。

## 阶段二：pure queue与JSON session

先抽无DOM的invalidation decision和JSON buffer transaction；组件仍持有record state，确保一次只改变一个边界。

## 阶段三：record与runner session

1. 迁移list/selection/draft/lease/CRUD到per-panel record session。
2. 迁移Prepare/runner command与runtime input client逻辑。
3. 每步删除组件内旧state/effect/continuation。

## 阶段四：收口

MacroPanel只做view composition；扫描duplicate owner、singleton、silent disabled和后台覆盖draft路径。运行race E2E及全Gate并记录状态等价证据。
