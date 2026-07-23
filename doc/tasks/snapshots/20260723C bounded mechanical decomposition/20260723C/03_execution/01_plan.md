# Execution Plan

## 文档阶段

1. 从`20260723B.004`建立`20260723C` root change。
2. 依次建立`.001-.014`，每个change只写自己的index、`00_meta`、`01_context`、`02_spec`与`03_execution`。
3. 全栈只做文档diff、路径、编号、关系、行数和`conflict=false`审计。
4. 停在Formal Document Gate，等待人工确认；不创建`04_review`，不修改active specs或任何代码。

## 后续实现阶段

以后从`.001`开始逐change实施：

1. `jj edit`目标child，复核其父change current source和文档边界。
2. 完成AI pre-review；发现分叉先修文档并等待人工确认。
3. 在同一change实现、补focused test、运行Gate并写`04_review`。
4. 检查自动rebase后的全部后继change；必须全部`conflict=false`。
5. 当前child完成后才进入下一个。

## Legacy Kill List

本任务没有schema/API legacy需要删除。每个child只清理被移动后的重复private implementation、无consumer type/helper和临时re-export；public compatibility branch不得新增，现有public facade不得删除。

## 整链停止线

只有`.001-.013`全部实现且所有受控文件小于等于400行，`.014`才删除退役historical source及专用hash逻辑、接入零豁免全项目Gate并运行全栈Close Gate。若必须改变公开契约、current测试语义或建立第二份state才能达标，root保持未完成并回到对应child重审，不通过豁免绕过。
