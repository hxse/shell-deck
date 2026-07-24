# Formal Contract

## 任务边界

### Library domain

* 删除`macro-template`、`prompt`、`note` Library kind、`LibraryItemV1`、summary/normalization/validation、`LibraryStore`、client、session、coordinator、workflow、invalidation queue和panel component。
* 删除`GET/POST /api/library/items`、`GET/PUT/DELETE /api/library/items/:kind/:itemId`与`POST /api/templates/from-library`。
* 删除Macro toolbar的`Save to Library`及Library的`Load into Macro`。Copy仍然只写clipboard；产品不新增Duplicate、Import、Export、Gist integration或copy-and-create。
* 删除`lib_` generated ID kind。任何Library-shaped content resource key现在按exact current contract抛出`invalid_content_resource_key`。
* 删除Library-specific error code、status text、test id、DOM、keyboard/focus/resize behavior和notification wording。

### 范围外与停止线

* 不新增Gist integration、Import/Export、schema migration CLI、通用saved-content抽象或远程内容服务。
* 不自动删除existing `library/`字节；代码和文档删除、两个current V5 source完成带备份的fresh MacroRecord创建、旧入口失败证明与全量Gate通过后停止。
* 不修改Macro runner、terminal、Room controller、evidence或notification语义；除明确删除的Library UI和wiring外，不授权其他交互或presentation重做。

## 任务规范

### Browser settings v4

* `BROWSER_SETTINGS_KEY`直接变为`shell-deck:settings:v4`，`schemaVersion`为literal `4`。
* exact top-level keys为`schemaVersion/theme/panels/macroInsertionPlacement/terminalDragEnabled/notificationVolume`。
* `panels` exact keys只有`macro`；删除Library visibility/width与top-level Library tab/filter preference。
* default继续使用`business` theme、visible 760px Macro panel、anchored insertion、disabled terminal drag和2.4 notification volume。
* loader只读取v4 key。v3及更早key不读取、不删除、不转换；v4 key中的旧shape、missing/extra key或非法值整体reset到deep-cloned v4 default。
* head Theme bootstrap与application loader共用同一v4 exact validator；不复制第二套schema。

### User Data Root与lease

* managed directory exact set为`macros`、`runs`、`agent-events`、`.locks`。`library/`不再创建、权限审计、扫描、读取、写入或删除。
* `UserDataPaths`不再暴露`library`。
* `ContentResourceKey`只有exact `{kind:"macro",itemId}`；string identity只有`macro:<tmpl_id>`。
* Macro lease authorization、expected revision、atomic publication、state persistence、renew/release与broadcast顺序保持。

### One-off Data Migration

* 数据操作不进入repository production/test source，不被server startup调用。
* source固定为执行时default User Data Root中的Library macro-template JSON；每个source必须同时通过exact Library envelope审计与current `parseAndValidateMacroDefinitionJson`/`validateMacroDefinitionV5`。
* 写入前把原`macros/`与`library/`原始bytes复制到private sibling backup，记录backup path。
* 对每个与现有MacroRecord definition不完全相同且尚未迁移的source调用current `MacroRecordStore.create`；生成fresh id、revision 1和current timestamps。
* 不通过title覆盖definition name，不因重名合并，不覆盖或删除任何existing MacroRecord。
* 每个created record必须由current store read-back并再次通过V5 validation；记录source item id、source definition digest、new record id与read-back digest。
* 任一步失败时不删除source或backup；不得通过旧schema parser、字段补全、alias或manual repair继续。
* 原`library/`bytes在成功后仍保留，但current application完全忽略。它们不是受支持的runtime input或compatibility source。

### Frozen Semantics

* MacroRecord envelope、MacroDefinitionV5、API `/api/templates`、edit lease、revision、validation issue code/path/order与runner Start保持。
* Macro selector的List/New/Edit/Save/Cancel/Copy/Delete、JSON Edit及read-only lease interaction保持，除移除`Save to Library`外不重排其余control。
* Macro dirty是唯一saved-content `beforeunload`来源；Room/terminal shared state和browser-local Theme继续按既有owner工作。
* Theme catalog、默认`business`、first-paint bootstrap、terminal layout、workspace breakpoint、focus/Escape/clipboard行为不变。
* historical task snapshots不回写；current documentation和test truth必须移除Library。

### Primary Files

* `server/http/contentRoutes.ts`、`server/http/httpContext.ts`、`server/httpServer.ts`、`server/contentEditLeaseService.ts`、`server/userDataRoot.ts`。
* `src/App.svelte`、`src/lib/browserSettings.ts`、`src/lib/contentEditLease.ts`、Macro session/workflow/components与Workspace shell。
* 删除`server/libraryStore.ts`、`src/lib/library/**`和`src/lib/components/LibraryPanel.svelte`。
* README、Quickstart、active specs、test/package/just inventories及受影响unit/integration/E2E。

### Negative Boundary

* 不保留空Library panel、hidden feature flag、deprecated type、dummy settings field、tombstone endpoint或on-disk auto-cleanup。
* 不把Library改名为Snippet、Prompt store或Gist cache。
* 不新增old-to-current schema migration、dual parser、version alias或best-effort conversion。
* 不修改历史snapshot来掩盖删除，也不保留current测试只为证明已删除的实现细节。

## 示例

current browser setting只有Macro panel，不接受任何Library字段：

```json
{
  "schemaVersion": 4,
  "theme": "business",
  "panels": {
    "macro": {
      "visible": true,
      "widthPx": 760
    }
  },
  "macroInsertionPlacement": "anchored",
  "terminalDragEnabled": false,
  "notificationVolume": 2.4
}
```

从Gist恢复时，用户先在Macro面板点击New，再进入JSON Edit并粘贴当时的current完整definition。例如current V5最小合法正文为：

```json
{
  "schemaVersion": 5,
  "name": "Gist macro",
  "description": "",
  "terminalLayout": [],
  "body": []
}
```

旧Library写法不进入兼容分支：

```text
POST /api/library/items
=> 404 {"ok":false,"error":"route_not_found"}

assertContentResourceKey({
  kind: "library",
  itemKind: "macro-template",
  itemId: "lib_..."
})
=> throws "invalid_content_resource_key"
```

一次性数据迁移只记录identity和digest，不把正文复制进repository：

```json
{
  "sourceId": "lib_...",
  "sourceRawSha256": "<sha256>",
  "definitionSha256": "<sha256>",
  "recordId": "tmpl_...",
  "recordRevision": 1,
  "readBackDefinitionSha256": "<same sha256>"
}
```

## 测试

* Focused unit：v4 exact round-trip、v3 non-read、old Library fields reset、default deep clone；Macro-only resource key接受/拒绝精确。
* Focused server：Macro CRUD/lease继续通过；removed endpoint返回generic 404；User Data Root不创建或审计`library/`。
* Static：除本task与历史snapshot/evidence语境外，production、current tests、README、guide、active specs、package和justfile无Library domain symbol、route、test id或storage field。
* Data：backup存在且权限收紧；两个source均生成fresh current MacroRecord，read-back digest一致；既有MacroRecord与source bytes未变。
* UI：topbar与workspace无Library，Macro toolbar无transfer action，其余current control inventory、structure和theme assertions按有意delta更新。
* Close：`just check`、`just build`、unit、integration、Chromium E2E `--workers=1`、file-size、diff-check与`jj` conflict审计顺序通过，未解决P1/P2为零。
