# 20260724A Remove Library Domain

## 任务概括

彻底删除shell-deck的Library产品域，保留MacroRecord作为唯一可编辑、可持久化的用户内容。删除Library UI、browser setting、client/session、HTTP API、store、generated identity、edit-lease variant、user-data directory ownership、测试和current文档；不增加tombstone endpoint、旧schema reader、alias、runtime migration或兼容分支。

当前用户目录中的两个合法Macro JSON Library item先做外部备份，再通过current MacroRecord store各自创建fresh `tmpl_` record。该一次性数据操作不进入production runtime，也不覆盖现有MacroRecord。

## 正式 task 级别及定级原因

三星任务。

这是用户明确授权的破坏性current-schema-only更新，横跨frontend、HTTP contract、saved-content lease、user-data storage、browser settings、test inventory与用户真实数据。虽然删除方向明确，但漏掉任一reader、route或settings field都会形成假删除；真实数据迁移若不先验证和备份则可能造成不可恢复的数据损失，因此需要完整Formal Document、Code、Data Migration与Close Gate。

## 范围内

* 删除Library全部production owner与入口，包括Macro和Library之间的双向transfer action。
* 将content edit lease exact resource key收窄为Macro-only。
* 将browser settings从exact v3 hard cut为exact v4并删除全部Library preference/panel state。
* 从User Data Root managed directories中删除`library/`；existing on-disk directory停止被创建、扫描、读取、写入或删除。
* 删除Library专用测试，更新受影响的current inventory、UI structure oracle和active specs。
* 备份当前真实Macro/Library数据，并把两个通过唯一V5 validator的Library macro-template创建为fresh MacroRecord。
* 顺序执行focused、check、build、unit、integration、单worker Chromium E2E、file-size、diff与`jj` conflict Gate。

## 范围外

* 不为Gist、Import/Export、schema migration CLI或远程内容服务设计新功能。
* 不迁移Prompt/Note；当前数据审计未发现此类item，Library删除后也不保留其schema。
* 不读取、转换、修复或容忍任何旧Macro schema。非V5输入必须fail loudly。
* 不自动删除用户原始`library/`目录；备份和fresh MacroRecord成功后它只成为runtime不认识的orphaned bytes。
* 不修改Macro runner、terminal、Room controller、evidence或notification语义。

## 决策归属

用户已拍板彻底删除Library、采用破坏性更新且不保留旧兼容。AI可执行必要的代码、文档、测试与一次性真实数据迁移；若发现invalid source或写入后无法从Macro store精确读回，必须停止数据迁移并保留原始数据，不能增加兼容逻辑绕过。
