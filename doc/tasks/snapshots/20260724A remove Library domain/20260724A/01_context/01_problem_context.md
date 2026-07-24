# Problem Context

## 当前负担

Library同时拥有三种kind、独立store/API、跨process transaction、per-record edit lease、remote invalidation、browser-local navigation/edit state、side panel、Macro双向transfer action以及大量unit/integration/E2E oracle。它与MacroRecord形成两套保存同一Macro JSON的持久化模型，却没有提供用户真正需要的schema升级能力；现行contract反而明确拒绝旧schema、Import和Export。

用户决定以Gist等外部工具保存可复制的Prompt或Macro JSON，shell-deck只维护执行所需的MacroRecord。继续保留Library会让每次Macro schema、lease、theme、workspace或测试重构都承担额外的交叉矩阵，收益不足以覆盖维护成本。

## Current truth与破坏性边界

删除后的唯一saved-content domain是Macro。旧`/api/library/**`与`/api/templates/from-library`不返回专用“已删除”响应，而是和所有未知API一样返回`route_not_found`。旧Library content resource key不再是合法protocol value。`lib_`不再是generated ID kind。旧browser settings v3既不读取、不删除，也不转换；v4缺失时直接使用current default。

User Data Root只管理`macros/`、`runs/`、`agent-events/`与`.locks/`。实现不会扫描或清理现有`library/`，避免启动应用时偷偷执行数据迁移或删除。历史task snapshot保留其当时事实；README、guide与active specs只描述删除后的current product。

## 真实数据审计

执行前审计得到：

* `macros/`有一个revision 13的MacroRecord，definition为合法`MacroDefinitionV5`。
* `library/macro-template/`有两个item，revision分别为4和2，embedded definition均为合法`MacroDefinitionV5`。
* 两个Library definition与现有MacroRecord内容都不相同，其中一个名称与现有record相同。
* `library/prompt/`与`library/note/`没有current item。

因此不需要schema升级器。一次性迁移只改变domain envelope：先复制原始bytes到用户数据根之外的private backup，再经canonical V5 validator读取definition，通过`MacroRecordStore.create`生成两个fresh `tmpl_` record。重名保留，因为名称不是identity；既有record和原Library bytes均不覆盖、不删除。

## 为什么不提供runtime migration

runtime reader或启动时自动搬运会永久增加“是否已经迁移”“部分成功”“重名”“旧schema”分支，也与current-schema-only规则冲突。真实数据是已知且数量有限的本机状态，适合在本task中做可审计的一次性操作。未来外部Gist内容进入shell-deck仍必须显式Paste到current JSON editor并通过当时唯一validator，不能靠Library compatibility layer。
