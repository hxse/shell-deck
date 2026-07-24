# Review and Verification

## 总体判断

本轮同时审阅代码和文档。Library的production store、HTTP、lease variant、generated ID、browser setting、frontend session/panel、Macro transfer、测试入口和current contract已经完整退出；MacroRecord成为唯一saved user-content model。真实数据在执行阶段先备份，再由current V5 validator和`MacroRecordStore.create`生成两个fresh record并完成read-back；用户随后主动删除这两个迁移record并明确无需恢复，原Library source与private backup仍保留。

后续只读复审发现并修复一处active spec v3残留、一个被旧schema掩盖的Library-shaped v4 settings反例和一个`.036` current E2E旧名称。未发现剩余P1/P2。Code、Data Migration、Current Docs与自动化Close Gate通过；用户已完整人工审阅并批准`AGENTS.md`中的Macro-only目标与三条现行约束。

## Gate 结论

| Gate | 结果 |
| --- | --- |
| Focused unit | 57通过，0失败 |
| Removed endpoint integration | 1通过，0失败 |
| Focused Chromium E2E | 10通过，0失败，1 worker |
| `just check` | 通过；file-size/style clean，TypeScript/Svelte 0 error、0 warning |
| `just build` | 通过；217 modules，4.17秒 |
| `just test-unit` | 通过；theme 6 + core 226 + integration 48，共280项 |
| `just test-integration` | 48通过，0失败 |
| `just test-e2e` | 55通过，0失败，1 worker，3.3分钟 |
| `just file-size` | 313个project-authored code文件，全部不超过400行，0 exception |
| `just diff-check` | 通过 |
| Static residue | `server/`、`src/`、`package.json`与`justfile`无Library symbol/route/storage/test入口 |
| Data migration | 执行时backup、source validation、fresh create、read-back digest与原bytes复核全部通过；后续删除经用户确认为有意操作 |
| jj | `rrqpoptq`基于`vlmyuvyz`，目标与parent均`conflict=false` |

第一次在filesystem/network sandbox内执行integration和build时分别遇到临时端口拒绝与Vite无输出挂起；这两条命令已停止且没有残留子进程。相同正式入口在sandbox外分别正常通过，最终复审build耗时4.17秒，因此不构成项目warning或未通过Gate。

## 决策到代码覆盖

* server/storage：删除`LibraryStore`与全部Library route/context/startup option；Macro route只匹配current `tmpl_` identity，其他路径落入generic 404。`ContentResourceKey`、generated ID和edit-lease path只保留Macro；User Data Root不再创建或审计`library/`。
* frontend：browser setting hard cut到exact v4；App、Workspace和Macro workbench删除Library panel/toggle/resizer/dirty state、Load与Save transfer。其余Macro CRUD、draft、lease、runner和terminal交互未重排。
* tests：删除Library专用unit/integration/E2E/fixture与public recipe，新增旧resource key和旧HTTP route失败证明；current UI inventory、structure fingerprint、theme matrix与test discovery按精确删除delta更新。
* current docs：删除active `library_contract.md`，同步README、Quickstart、AGENTS与Macro/Room/storage/theme/architecture active specs；历史snapshot保持不动。

## 数据迁移证据

private backup：

```text
/home/hxse/.local/share/shell-deck-backups/20260724A-library-removal
directories: 0700
files: 0600
```

backup内包含原始`macros/`、完整`library/`、`source-manifest.json`和`migration-result.json`。一次性迁移执行时，原有Macro保持：

```text
tmpl_htbkeWEUv25SmY8KdU41MF
revision: 13
raw sha256: bd259cf22fde4d27ee002af92922b2bfc33b2fa280602cd1716f3b0e822e111b
definition sha256: fd870bcbb6ba24277fffe867aeb7db0f30dbbb718bd11e1948f922dbdf8a4e6f
```

迁移结果：

| source | source raw SHA-256 | definition SHA-256 | fresh MacroRecord |
| --- | --- | --- | --- |
| `lib_5tQdPmwEQbXEQzJDuBzCHF` | `b8cf25708c456b1fbb716caf9dd392888865db18ac997433bf9c40f28260c5eb` | `5dee5d2ada2250785e1df8e13bc8486d11c3fc7daa8984ad0b7abcf462d6c27e` | `tmpl_wmkcVzQ3hkWRRzwzBbsmmN`, revision 1 |
| `lib_6HjXDFj3WoQS7ASq1Q9vvL` | `435da0a3fab4ccc554e029abde8036a286dd359253218832fb875ff16308deb1` | `363fc88c87390e0d468646731c40a6d5d0ec3e880b88601c48313e02c2dfaab4` | `tmpl_tQspd9T7vMKoJWNEBQfq25`, revision 1 |

两个fresh record的read-back definition SHA-256分别与source完全相同。临时迁移脚本已删除；原`library/`bytes未删除，但application不再认识或读取它们。

后续只读复审发现上述两个fresh record已不在current `macros/`目录：原Macro在迁移约54分钟后更新为revision 14，另有一个fresh Macro在约57分钟后创建。用户确认这两个迁移record由其主动删除，并拍板不恢复。该状态是迁移成功后的用户操作，不是迁移失败；原Library source与private backup继续提供恢复证据。

## Findings and Solutions

### 已修：空Library目录残留

focused test发现文件删完后`src/lib/library/`空目录仍存在。已将空目录移出workspace，production path现在不存在，删除反例测试通过。

### 已修：旧transfer path被宽泛Macro route误接

删除显式route后，`/api/templates/from-library`一度被`/api/templates/:id`捕获并返回invalid ID 400。Macro record route已收紧为只匹配`tmpl_` current identity；旧path现在与其他unknown API一致返回404 `route_not_found`，没有增加tombstone或compatibility branch。

### 已修：Theme E2E把全局Room数量当oracle

focused多spec共享server时，Theme matrix错误要求Home恰好只有一个Room。测试现按本case新建的exact Room id定位，继续验证同一surface，不依赖其他spec是否保留Room。

### 已修：task context写错source revision

真实source revision为4和2，不是1。context已按审计值更正；fresh MacroRecord才固定为revision 1。

### 已修：architecture active spec残留browser settings v3

后续复审发现`active_specs/shell_deck_architecture.md`仍把Theme preference写成browser settings v3，与production和storage/theme active spec的exact v4冲突。current architecture truth现已同步为v4。

### 已修：Library-shaped v4 settings反例被旧schema掩盖

原focused反例同时携带`schemaVersion: 3`和旧Library字段，即使validator错误接受Library字段也会因版本错误通过。测试现分别使用exact v4验证top-level `library`与`panels.library`都会整体reset。

### 已修：current E2E仍引用已移除的.036

`comprehensiveUiBehaviorCurrent.spec.ts`的current journey title仍写`.036`。名称现已收口为`current Macro-only UI journey`，不再把已删除的Library task当作current UI identity。

### 已确认：迁移后fresh MacroRecord由用户主动删除

后续数据核验发现迁移生成的两个record已不在current data root。用户确认删除是有意操作并明确无需恢复；backup与原Library source继续保留，production仍完全忽略旧Library bytes。

### 已拍板：AGENTS.md Macro-only规则获人工批准

用户已完整人工审阅并批准项目目标中的Macro-only saved record，以及Prepare、content edit lease和Copy三条技术边界；内建Library、Import与Export继续明确不存在。

## 需要人工拍板

无。用户已确认迁移后record删除是有意操作且无需恢复，并已完整人工审阅、批准`AGENTS.md`的Macro-only修改。

## AI 可直接修

后续复审发现的active spec v3残留、v4 Library-shaped settings oracle和current E2E旧名称均已修复，无待修L1/L2。

## 未覆盖与残余风险

* 按用户拍板，未来Gist中的旧Macro schema不会自动升级；用户必须先在外部按当时current schema更新，旧输入在JSON validation阶段fail loudly。
* 原`library/`保留为application忽略的orphaned bytes，仍占少量磁盘；这是防止自动删除用户原数据的有意边界，private backup提供第二份恢复点。
* 一次性迁移执行时没有增加真实data root浏览器UI smoke；canonical store read-back、V5 validator与digest证明了当时的迁移结果。两个迁移record后来由用户主动删除，因此current data root不再承担这两条内容的UI smoke，backup仍可审计。

## 审阅范围

审阅了目标change相对parent的全部production、test、current docs、task/index与command入口diff；核对了删除路径、旧symbol/route/settings residue、Macro不变量、UI structure/inventory、真实data root与backup evidence。后续复审继续核对了用户主动删除后的data root状态、AGENTS人工批准、settings v4反例与current E2E命名。未回改其他历史task snapshot。
