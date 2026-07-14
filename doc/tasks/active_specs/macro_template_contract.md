# Macro V3 Contract

## Definition 与 Record

唯一可运行格式是 `MacroDefinitionV3`：`schemaVersion` 必须精确为 `3`，并包含 `name`、`description`、`terminalLayout` 与 `body`。`terminalLayout` 只保存从 1 开始连续的 terminal `index/type`；definition 不保存 record metadata、Room/server identity、cwd、terminalId、launchId、alias 或旧 configId。

持久化 envelope 是 `MacroRecord`：server 生成 `tmpl_` id、revision、createdAt、updatedAt，并把 definition 放在 `definition` 字段中。JSON editor、clipboard Copy 与后继 Library macro template 只处理 definition，不处理 record envelope。

这是 current-schema-only hard cut。旧 Macro V2、config-scoped route/store、physical terminal target、alias、migration、adapter、dual validator 与自动转换均不存在；旧输入必须 fail loudly。

## Validation

`src/lib/macro/macroDefinitionValidation.ts` 是唯一 validation gateway：

* `validateMacroDefinitionV3(input)` 校验 object，并复用唯一 terminal-layout validator。
* `parseAndValidateMacroDefinitionJson(text)` 是完整 definition 文本的唯一入口，统一返回 stable `invalid_json` position 或 closed issue-code registry 中的 issues。
* `parseAndValidateMacroTerminalLayoutFromDefinitionJson(text)` 只供显式 Prepare 从当前 JSON buffer 读取 layout；它不以 name/body 的其他错误阻止 layout Prepare，也没有 last-valid fallback。

Visual editor、JSON editor、server CRUD、runner 与 Library consumer 不得自行维护第二套 schema、JSON 错误解析、issue 排序或兼容分支。portable validation 只检查 definition/Flow、连续 layout、terminalIndex 引用和 capability，不读取 live Room。

### Definition validity、Room compatibility 与操作 Gate

MacroDefinition内部合法性与当前Room可运行性是两层独立真值。portable validator覆盖exact schema、Flow/Parallel结构与唯一id、If/Elif/Extract的earlier/scope/capability-compatible source、template/regex、连续terminalLayout以及Action/lane引用的layout index/type/capability；live runtime validator另行检查当前Room是否缺少index、type是否变化、terminalId/launchId binding是否仍成立及readiness。definition中的index/type是portable logical truth，id/launch/readiness只属于live Room。

invalid draft必须继续可编辑并显示统一issues，但Save/Create/Update、JSON commit与Start均禁止。若JSON可解析且terminalLayout子验证合法，显式`Prepare terminals`仍可执行，不能被无关body/source错误阻止。definition合法但Room mismatch/not-ready时Save仍允许，Start必须以stable runtime诊断阻止；runtime诊断不得混入portable issues、改写draft或触发Prepare。definition与Room均ready时，Start仍须通过saved revision、controller、structure revision与lock前置条件。

例如，内部自洽的`1 · shell`definition在空Room、index 1为text或shell exited时均可Save，只在Start时报missing/type mismatch/not-ready；layout只有index 1而Action引用index 2则是definition内部非法，即使Room存在第二个terminal也禁止Save与Start。

Visual editor不展示独立Terminal layout section。Send、Input、terminal-quiet Wait、Capture与Parallel lane共用同一live-terminal projection和selector state，只显示`N · shell/text`，不显示`Room`、Macro slot或physical identity后缀。用户显式选择target时，同一次draft mutation必须从既有layout尾部到所选index复制完整连续`index/type` prefix，再更新Action/lane target；每次visual mutation后递归扫描实际terminal引用，并裁掉最高引用之后的unused layout tail。不得保存terminalId/launchId/cwd，不Prepare、不隐式Save。New shell/text、delete/reorder/readiness等terminal event只刷新选项与runtime validation，绝不改写draft。新增terminal-bound Action在Room已有兼容terminal时采用第一个terminal并原子派生layout；Action先于terminal创建时保持unconfirmed，等待用户显式选择。no-terminal、unconfirmed、missing index、type/capability不匹配或lane占用都必须显示明确placeholder，不能留下空白selector。JSON编辑保持纯文本语义，不读取Room或自动派生。

Visual authoring是允许乱序搭建的draft editor，不强制用户按最终执行顺序从头写到尾。结构Add/Move只受body/branch/lane结构规则约束，不得因当前引用或其他语义依赖未完成而拒绝；用户可以先建consumer，再通过Add before/Move补齐producer。未完成draft保持可编辑并显示validation，`Start`必须禁用；不得撤销结构mutation、自动创建/重排producer或猜测引用。Save/JSON commit仍要求通过唯一current-schema validator。

Visual editor创建If/Elif/Extract时必须始终完成结构插入。若exact insertion point之前、当前scope存在compatible artifact，默认选择最近的一个；若不存在，保留明确的未选择source编辑态，selector显示`Select an earlier artifact`，validation阻止Save/Start直到用户选择合法source。该空stepId只属于invalid visual draft，不是可保存schema；不得猜测`capture_1`或引用future/sibling-branch output。Parallel lane Extract遵循同一规则，只可选择outer earlier artifact和本lane插入点之前的local artifact。

## CRUD 与 editor lifecycle

production surface 只提供 list/create/read/update/delete。Create/Update/Delete 是 shared mutation，必须同时通过 Room controller guard；既有 record 的 Edit/Update/Delete 还必须持有 `.033` 的 per-record content edit lease并匹配 expected revision。Delete按钮可从read-only selected record直接发起，但操作内部仍必须acquire/takeover lease、重读current record并按expected revision删除，不能要求用户先点Edit。New 是 client-local draft，新 Room默认不选Macro；New/editing期间selector与New保持可用，dirty切换走discard确认，拒绝时native select回滚，接受时release lease。selector首个`Select macro`空值option是可选的显式null selection：clean时清除selected/base/draft并回到`No macro selected`，dirty时遵守同一discard确认；它不Delete/Save/Prepare或影响active run。New Discard彻底清除draft，搜索结果始终固定显示current selection。Save只保存portable definition，不要求terminal layout当前匹配，也不触发Prepare；它更新base revision、清dirty并保留当前Edit session/lease，clean session用Done退出。New首次Create后必须取得fresh record lease才继续编辑，竞争失败保留saved record但转read-only并提示。

Update/Delete的record atomic publish是point-of-no-return。publish后lease-state refresh/release失败仍返回并广播authoritative saved/deleted result，并以lost lease outcome让client转read-only；不得把durable commit伪装成失败或让旧lease继续编辑。

Macro panel visibility只是browser-local UI布局：组件保持常驻，隐藏/显示不得清空selection、draft、JSON buffer、dirty或lease。selection/draft/JSON buffer只存在于页面内存，不写入`localStorage`、`sessionStorage`或server；browser storage只保存visibility/width等UI偏好。dirty Macro或打开的JSON Edit必须触发native `beforeunload`确认，取消离开保持原内存状态，确认离开才丢弃；V0不恢复刷新前draft。

Copy 只把 canonical pretty-printed definition 写入 browser clipboard。没有 Duplicate、clone、copy-and-create、Import 或 Export；创建相似 Macro 的路径是 New → JSON Edit → Paste → Save，由 server 生成 fresh record identity。

JSON Edit期间以及 Save/Create/Start等 lock-sensitive operation pending期间，visual/JSON editor、selector和相关入口必须 inert；统一 draft mutation入口仍做 defensive guard。异步 response 只有在 operation generation、record/revision、draft revision、controller和lease identity仍匹配时才能 commit。dirty Start严格串行执行 Save/Create → 必要时取得fresh record lease → 使用 response 中的 fresh record revision Start，不能让旧 response覆盖后续编辑，也不能因内部Save把原Edit session切成永久read-only。run终态释放terminal structure lock；Macro editability仍由Edit session决定。

## 显式 Prepare terminals

Macro运行区只有一个文字按钮 `Prepare terminals`，位于 Start 左侧。不存在 Settings toggle、Auto-prepare、Use/Activate、Start-and-prepare或 selection/load/save/start/event trigger。

按钮读取当前正在显示的 visual draft，或 JSON Edit中的当前 JSON buffer；New、dirty、saved draft只要 layout合法均可使用，不要求 record identity或先 Save。Prepare request只携带 canonical terminal-layout snapshot和 `expectedTerminalStructureRevision`，不读取或修改 MacroRecord。

resolver只按顺序 keep/move/create/insert缺少的 shell/text，不删除、reset、等待或治疗 starting/exited/failed terminal。Macro Prepare创建Shell时使用 `$HOME`。backend中途失败立即停止并返回最新 authoritative partial snapshot；已成功的步骤保留，不 staging、不 rollback。terminal/layout没有产品级数量上限。

## Start

Start只运行明确保存的 MacroRecord revision。server在同一 Room structure operation中复核 expected Macro revision、expected terminal structure revision、完整 portable validation、index/type和readiness；失败时不修改 terminal，也不创建 run。成功后把完整 definition、record revision、Room generation、structure revision及每个 index/type解析出的 terminalId/launchId冻结到 run snapshot，Action执行期间不再按 live index解析，也不重读 MacroRecord。

runner tight loop按固定budget执行macrotask cooperative yield并在yield后复核abort/pause。terminal-quiet比较frozen launch的单调outputActivityRevision，不比较截断replay长度。Input submit先durable append event再清pending/resume，append失败保留可重试input；每个run只能提交一个终态。Prepare HTTP snapshot按roomRevision monotonic merge，不能回滚更晚WebSocket Room真值。
