# 20260627A.034 Contract

## 任务边界

本任务以.032的User Data Root、Room Home/lifecycle、MacroRecord path/envelope/resource transaction primitive、generated ID module、routed Room、per-terminal cwd、browser-local settings、Room-scoped AgentEvent和read-only Trace，以及.033的Room controller/content edit lease为硬前置。.034负责production Macro CRUD/editor/runner原子cutover，并定义MacroDefinitionV3、portable validation result/issue contract、terminal layout resolution/readiness、version-bound Prepare/Start、immutable run snapshot、frozen-ID routing与active-run terminal structure lock。

交付停止线：

* MacroDefinitionV3 只接受 schemaVersion 3，含 exact name、description、terminalLayout、body。
* MacroRecord拥有tmpl_ record id、revision、createdAt、updatedAt；definition不拥有这些字段；.034把production CRUD接到.032 primitive并逐字消费.033 edit lease。
* Macro 与 Library 的 terminal reference 只保存 terminalIndex/type，不保存 Room、terminalId、launchId、alias、cwd 或 server identity。
* terminalId 跟随 terminal 对象，index 跟随 server-authoritative UI order；Start 只解析一次 index -> terminalId。
* 新Room不选择任何Macro。Settings面板不存在terminal Prepare toggle；Macro selection与.035 Library Load都不修改Room。
* Macro运行控制区在Start左侧提供唯一文字按钮`Prepare terminals`。只有用户点击才触发；它消费当前visual/JSON draft的validated terminalLayout snapshot，不要求clean、已保存或record identity，也不隐式Save。
* selection、New、首次Save、普通Save、reload、remote refresh、Library Load、terminal变化和Start都不触发Prepare；Prepare期间当前draft/JSON buffer/selector/button串行锁定。
* 不存在 Use/Activate、Start-and-prepare、selection/load/event-triggered Prepare或 reactive repair。
* Prepare 只修正 index/type 结构，不等待、restart、替换或治疗 starting/exited/failed terminal；backend中途失败立即停止并返回authoritative partial result，不staging、不rollback。
* Room terminal数量与terminalLayout.length不设产品级硬上限，不存在MAX_TERMINALS_PER_ROOM或terminal_capacity_reached；OS/backend资源失败走普通Prepare backend error与authoritative state同步。
* 全部 terminal 结构/lifecycle 变化持续触发只读 validation；mismatch/not-ready 标红并禁用 Start。
* Save只运行portable MacroDefinitionV3/Flow validation并提交record，不读取Room terminal、不触发Prepare，也不因layout mismatch/not-ready失败。
* Prepare只绑定request terminalLayout snapshot与expectedTerminalStructureRevision，不读取MacroRecord；Start绑定expectedMacroRevision与expectedTerminalStructureRevision。stale request返回稳定conflict并零mutation。
* Start只加锁、校验并冻结完整definition与terminal snapshot；失败时零Room mutation、零run，运行中不重读MacroRecord。
* Running、Paused、Stopping 期间冻结 terminal 结构；.032 Room Home generation-bound Destroy始终可用并终止run。
* active run 只按 frozen Room generation + terminalId 路由，不随 live index 变化。
* Pause/Resume/cursor/snapshot 只存在于 live Room 内存；restart 后 Trace 只读保留，不 durable Resume。
* production Macro server surface只保留list/create/read/update/delete；Duplicate/clone/copy-and-create route与UI全部删除。
* Macro JSON Copy只复制当前显示文本到clipboard，不创建record；相似Macro通过New → JSON Edit → browser Paste → Save。Import/Export入口删除。
* 旧Macro/TerminalTarget/alias schema不迁移、不兼容。

Library CRUD、Room routing/storage primitive、controller/edit lease协议、notification profile、AgentEvent ingest、terminal restoration、跨process live Room sync与旧数据conversion均在范围外。

## Macro UI精准重构边界

`.031`是本任务Macro presentation/interaction的reference implementation，不是Macro V2 schema/API真值。实现必须优先从该revision恢复并改造`MacroPanel.svelte`、`components/macro/**`、Macro/run相关CSS及仍有效的behavior tests；允许拆分强耦合组件和替换数据wiring，但不得复制旧type/store/route/validator、添加adapter或让V2对象进入current runtime。`.032`删除这些文件只是current-schema-only中间态，不构成从空白设计新工作台的授权。

本任务UI变化分为三类：

* 必须改变：MacroDefinitionV3/MacroRecord/lease/editor state wiring；terminal target改为index/type；移除alias/title、Duplicate、Import/Export与Prepare setting；加入唯一`Prepare terminals`、V3 validation/readiness、controller/lease readonly和version-bound Start状态。
* 允许局部调整：为上述control、错误、busy/disabled状态留出必要空间，或为Svelte 5/state ownership拆分component；应复用既有button、icon、popover、textarea、tab和notice视觉语言，并把改动限制在直接consumer。
* 默认保护：Macro工作台与terminal区的整体编排和比例、Macro/Editor/JSON/Trace层级、toolbar密度、Start/Pause/Stop主次、step/branch/parallel的缩进与block视觉、collapse/move/add/remove操作方式、icon对齐、textarea自动高度/临时resize/行号、模板选择与JSON edit/cancel/save流程、字体/配色/spacing及其他未被本contract点名的精调交互。

这不是pixel lock，也不要求截图对照；新contract确有需要时可以改进局部UI。实现前必须形成逐文件touch manifest，记录`.031`来源、保留的interaction、必须替换的wiring和修改理由；不能以“重写更容易”为理由扩大范围。review必须列出全部有意偏离及contract依据，并检查touch manifest外的UI/CSS diff。行为Gate使用DOM order、可见control、keyboard/focus、disabled/inert、draft preservation和交互结果断言，不锁定截图。

`.031B`工作区内的`.031A`历史source/runtime inventory与完整UI journey保持不可变；本task只在`.034`工作区维护current source snapshot和current journeys。contract明确新增、删除或改变的control必须归因到`.034`并更新current测试；surviving Room/Home/terminal/Macro interaction失败属于意外漂移，必须修代码或恢复stable DOM identity，禁止通过放宽或删除历史断言掩盖。组合journey必须使用同一server-authoritative UI正常处理Root在空Room registry与已有Room registry下的两种合法入口。

## 任务规范

### MacroDefinitionV3 与 MacroRecord

唯一可编辑、可复制为clipboard文本和可放入Library的Macro definition为：

    type TerminalType = shell | text

    type MacroTerminalLayoutItem = {
      index: number
      type: TerminalType
    }

    type MacroDefinitionV3 = {
      schemaVersion: 3
      name: string
      description: string
      terminalLayout: MacroTerminalLayoutItem[]
      body: FlowV2Node[]
    }

top-level 只允许这五个 exact keys。terminalLayout 可为空；非空时 array order 必须精确对应连续 1..N，禁止 gap、duplicate、unknown field 或其他 type。它描述所需 Room prefix；N 之后 extra terminal 合法并保留。V0不对terminalLayout.length或live Room terminal count设置产品级数值上限；通用HTTP request-byte限制可以独立存在，但不得转换为terminal数量contract。

.032提供primitive，.034正式持久化：

    type MacroRecord = {
      id: string
      revision: number
      createdAt: string
      updatedAt: string
      definition: MacroDefinitionV3
    }

MacroRecord id是持久化内容identity，不是terminal target。server创建record metadata，Macro editor JSON只编辑definition。Definition不接受id、revision、createdAt、updatedAt、projectId、roomId、configId、cwd、terminalId、launchId、alias、server URL或server identity。

Flow node、branch和lane的id是definition内部semantic key，不使用generated ID factory。terminal/launch/run/event/notification等system opaque ID继续使用.032唯一factory。

### 唯一Macro validation gateway

`src/lib/macro/macroDefinitionValidation.ts`拥有唯一public current-schema入口与issue类型：

    type MacroDefinitionIssueCode =
      | "expected_object"
      | "expected_array"
      | "expected_string"
      | "expected_boolean"
      | "expected_integer"
      | "missing_field"
      | "unknown_field"
      | "invalid_literal"
      | "invalid_identifier"
      | "duplicate_identifier"
      | "invalid_reference"
      | "invalid_regex"
      | "invalid_template_syntax"
      | "invalid_range"
      | "terminal_layout_not_contiguous"
      | "terminal_reference_missing"
      | "terminal_capability_mismatch"
      | "semantic_conflict"

    type MacroDefinitionIssue = {
      code: MacroDefinitionIssueCode
      path: string
      message: string
    }

    type MacroDefinitionValidation =
      | { ok: true; value: MacroDefinitionV3 }
      | { ok: false; issues: MacroDefinitionIssue[] }

    type MacroDefinitionJsonValidation =
      | { ok: true; value: MacroDefinitionV3 }
      | {
          ok: false
          error: {
            code: "invalid_json"
            offset: number
            line: number
            column: number
            message: string
          }
        }
      | {
          ok: false
          error: {
            code: "invalid_macro_definition"
            issues: MacroDefinitionIssue[]
          }
        }

    type MacroTerminalLayoutValidation =
      | { ok: true; value: MacroTerminalLayoutItem[] }
      | { ok: false; issues: MacroDefinitionIssue[] }

    type MacroTerminalLayoutJsonValidation =
      | { ok: true; value: MacroTerminalLayoutItem[] }
      | { ok: false; error: { code: "invalid_json"; offset: number; line: number; column: number; message: string } }
      | { ok: false; error: { code: "invalid_terminal_layout"; issues: MacroDefinitionIssue[] } }

    validateMacroTerminalLayout(input: unknown): MacroTerminalLayoutValidation
    parseAndValidateMacroTerminalLayoutFromDefinitionJson(text: string): MacroTerminalLayoutJsonValidation
    validateMacroDefinitionV3(input: unknown): MacroDefinitionValidation
    parseAndValidateMacroDefinitionJson(text: string): MacroDefinitionJsonValidation
    validateMacroRuntimeBinding(definition, terminalPositions): MacroRuntimeValidation

`validateMacroTerminalLayout`拥有terminalLayout array/item exact schema、连续index和type规则；`validateMacroDefinitionV3`必须调用它，禁止复制第二套layout validator。full definition validation只检查MacroDefinitionV3 exact schema、Flow语法、terminalLayout连续性、terminalIndex引用和capability，不读取Room、terminalId、readiness或browser state。valid时返回canonical validated value；invalid时只返回issues，不抛出另一种caller-specific validation payload。path使用现有body[0].message.parts[0]形式的root-relative字段/index路径，top-level object本身用空字符串；code必须来自上面的closed MacroDefinitionIssueCode registry，message是统一user-facing文本。issues最终按path code-point升序、再按code升序稳定排序，相同path/code不得重复。caller不得创建、翻译或细分code；增加registry成员属于current contract变更，必须先更新本spec。

`parseAndValidateMacroDefinitionJson`是完整Macro definition文本的唯一public入口。`parseAndValidateMacroTerminalLayoutFromDefinitionJson`是显式Prepare唯一的JSON draft layout入口：两者必须复用同一shared parser adapter和同一invalid_json position/message实现，后者只从成功解析的top-level object读取`terminalLayout`并调用`validateMacroTerminalLayout`，不因body/name等其他字段错误拒绝layout，也不接受last-valid fallback。任何browser/server caller都不得在外部先执行JSON.parse、解析native Error.message或自行计算position。invalid_json的offset是输入JavaScript string中的zero-based UTF-16 code-unit index，EOF错误可等于text.length；line和column都是从1开始、按同一UTF-16 code units计算，LF、CR或CRLF各计为一个换行并把下一code unit置于column 1。message由gateway根据position生成，不透传runtime原生错误文本。完整definition parse成功但非法时返回invalid_macro_definition；Prepare layout parse成功但缺失/非法时返回invalid_terminal_layout与同一registry issues。

HTTP transport body自身不是Macro definition文本入口：HTTP framework无法解析request JSON时返回独立invalid_request_json；一旦取得body object，create/update调用`validateMacroDefinitionV3`，Prepare调用`validateMacroTerminalLayout`。JSON editor Save/Validate、Library macro-template Save/Validate/Load及任何clipboard/file-like full-definition consumer只调用`parseAndValidateMacroDefinitionJson`；JSON editor的Prepare按钮只调用`parseAndValidateMacroTerminalLayoutFromDefinitionJson`。runner从MacroRecord读取object后调用`validateMacroDefinitionV3`。禁止复制parser/layout validator、重新排序/改写issues或维护宽松第二套规则。

runtime binding validator负责把合法terminalLayout与authoritative live terminal positions比较，返回checking/mismatch/not-ready/ready及逐项诊断。Save绝不能调用它；Prepare只要求layout validation通过，Start要求完整portable definition validation通过，再按各自contract读取runtime。

current-schema-only：Macro V2、TerminalTarget、record wrapper冒充definition、unknown field和任何旧token必须由同一gateway fail loudly，不存在legacy branch、alias、conversion或“Library更宽松”路径。

### Portable definition validity、Room compatibility 与操作 Gate

产品不得把“MacroDefinition是否合法”和“当前Room现在能否运行它”合并成一个valid状态。两层真值必须独立计算、独立展示：

1. **portable definition validity**只由MacroDefinitionV3自身决定。它覆盖exact schema/required fields、Flow与Parallel结构、step/action/lane id唯一性、If/Elif/Extract source是否已选择且引用earlier/scope-compatible/capability-compatible artifact、template与regex语法、terminalLayout index从1连续且type合法，以及每个Action/lane的terminalIndex是否存在于definition layout并满足type/capability。这里不读取任何live Room。
2. **Room runtime compatibility/readiness**只回答一个已经合法的definition能否在当前Room启动。它覆盖layout index是否存在、live type是否相同、terminalId/launchId binding是否仍对应当前结构，以及terminal readiness是否为ready；starting/exited/failed都属于not-ready。create/delete/reorder/reset/restart及所有terminal lifecycle变化都必须重新计算这一层，不能遗漏事件。
3. MacroDefinition中的连续`index/type`是portable logical truth；authoritative live terminal position中的`index/type/terminalId/launchId/readiness`是runtime truth。Start按logical index查找live position、复核type/readiness并冻结physical binding；Save不得把runtime truth写回definition。

操作Gate冻结如下：

| 状态 | Visual/JSON继续编辑 | Save/Create/Update/JSON commit | `Prepare terminals` | Start |
| --- | --- | --- | --- | --- |
| portable definition非法 | 允许，保留invalid draft并显示精确issues | 禁止；client与server均由唯一full validator拒绝 | 当前JSON可解析且`terminalLayout`子验证合法时仍允许；body/source等无关错误不得阻止layout-only Prepare | 禁止 |
| definition合法，但Room mismatch/not-ready | 允许 | 允许；不得读取Room或把runtime诊断混入portable issues | 仅由用户显式点击，按既有layout-only规则执行；它不治疗readiness | 禁止，并在Macro validation与runner status给出missing/type-mismatch/not-ready等stable诊断 |
| definition合法且Room ready | 允许 | 允许 | 仍只由显式按钮触发 | 还必须满足saved record revision、controller、structure revision与lock等Start前置条件 |

Save/Create/Update与JSON commit都必须消费完整portable validator；invalid draft不得持久化。UI不能用“点击无反应”表达拒绝，必须保持draft可编辑并显示统一issue。Room mismatch/not-ready不得禁用Save、不得污染portable issue list、不得隐式Prepare或改写draft。

规范例：一个内部自洽、只声明`1 · shell`的definition，即使当前Room为空、index 1实际是text或该shell已经exited，也可以Save；Start分别返回missing/type mismatch/not-ready。反之，definition的terminalLayout只有index 1，而Action引用index 2，则definition内部非法，即使当前Room恰好存在第二个terminal也禁止Save与Start。

### Macro editor state与content edit lease

每个client的Macro editor state精确分为：

    {
      selectedRecord: MacroRecord | null
      baseRecordRevision: number | null
      draftDefinition: MacroDefinitionV3
      draftRevision: number
      dirty: boolean
      editLeaseId: string | null
      operationGeneration: number
    }

Macro panel的显示/隐藏只属于browser-local布局状态。顶栏Macro按钮不得通过unmount/remount清空当前selection、visual draft、JSON buffer、dirty状态或content edit lease；panel组件必须保持常驻，只切换可见性。

顶栏Macro入口必须使用与Settings toggle一致的switch视觉和native `aria-pressed`状态，不能依赖无样式的`active` class。side panel横向resize hit area固定为窄6px透明轨道，取消全局button padding/border，只显示居中的2px IDE式状态线；hover/focus/active只改变该线，不渲染宽色块。

Macro selection、draft和JSON buffer只存在于当前页面内存，不写入`localStorage`、`sessionStorage`或server。`localStorage`只保存panel visibility/width等UI偏好。当前Macro有未保存修改，或Macro JSON Edit仍打开时，页面必须注册native `beforeunload` guard：用户取消离开则原内存状态完整保留，确认离开则明确丢弃；clean状态不得弹窗。V0不实现刷新后的draft恢复。

新Room初始selectedRecord=null，不自动选择唯一record或上次record。saved record打开后默认read-only；显式Edit必须先控制当前Room，读取.033 safe lease view并携带expectedLeaseEpoch取得{kind:"macro", itemId:templateId} lease，成功后visual editor与JSON editor才可写。takeover确认必须携带confirmed:true与确认时看到的expectedLeaseEpoch。dirty Cancel丢弃draft、恢复current saved record并release lease；clean Edit session显示Done并只退出编辑/release lease；New draft的Discard则彻底清除无record identity的draft并回到null selection，不能留下clean但不可解释的unsaved draft。Save成功以response更新base revision、清dirty并保留当前Edit session与editLease。New首次Create成功后，client必须立即按fresh record key读取safe view并走正常available acquire；成功才以editing=true安装record，竞争失败则保留已创建record、切为read-only并明确显示`macro_saved_but_edit_lease_not_retained:<reason>`，不得自动takeover。

Macro selector与New入口在New/editing状态仍可操作；首个空值option显示`Select macro`，它是显式null selection，不是不可选placeholder。clean saved selection切到该option时release lease并清除selected/base/draft，回到`No macro selected`；dirty时必须先确认`Discard unsaved macro changes?`，拒绝确认必须把native select恢复到原selection且不改变draft/lease，接受后release当前lease再切换、清空或新建。取消选择不Delete/Save/Prepare，不影响Room active run。搜索过滤不得让当前selected record从select中消失或显示空白。Delete对任意selected saved record直接可用，不要求用户先点击Edit：Delete操作自己读取safe lease view，必要时按expectedLeaseEpoch确认takeover并取得temporary lease，重新读取current record后再确认删除，最后携带current expected revision提交；取消或失败时release temporary lease，成功后清selection。该便利入口不绕过controller、content lease或revision contract。

New创建client-local empty draft，selectedRecord/baseRecordRevision/editLeaseId均为null；首次Save调用create并由server生成fresh record identity。它不先为不存在的record取得lease，也不触发Prepare。create仍要求.033 Room controller，且若同一client在请求期间继续改变draftRevision，旧response不得替换当前draft/selection。

所有Edit/Save/Delete/Start等lock-sensitive async operation在pending期间必须让整个visual/JSON editor inert；统一draft mutation入口也必须defensive guard。operation identity至少包含operationGeneration、selected record id、baseRecordRevision、draftRevision、Room controller epoch与editLeaseId；每个await后的commit前复核。普通operation中任一变化都丢弃stale response；dirty Save/Create → Start只有下一段冻结的显式phase transition可改变identity。

JSON Edit打开时Start禁用。read-only clean draft直接Start当前selected saved revision。visual draft dirty时点击Start建立一个compound operation：

1. 捕获pre-save identity和调用者当时看到的expectedTerminalStructureRevision，并让整个editor/selector Start入口inert。
2. saved draft使用captured editLeaseId/expectedRevision保存exact draft；New draft使用exact create。await后先按pre-save identity复核draftRevision、operationGeneration、controller epoch、selected/base/lease均未发生意外变化。
3. Save/Create成功返回的fresh MacroRecord id/revision、dirty=false与继续有效的Edit session是允许的phase transition。existing Save必须返回同一record id和下一revision并保留原editLeaseId；New Create必须返回server fresh id/revision 1，再取得该fresh record的available lease后保持editing。client以response替换base并显式进入Start phase，不能因预期revision/record identity/新lease变化自行abort；fresh lease竞争失败不回滚已创建record，Start仍可使用saved revision，但editor明确转read-only并提示。
4. Start phase使用response record id/revision与第1步捕获的expectedTerminalStructureRevision发request，并再次复核controller/operationGeneration。Save期间terminal变化不静默采用新revision，而由server返回terminal_structure_revision_conflict；record已经成功保存，不回滚。
5. 任何未列出的draft、selection、controller、record response或operation变化都停止compound operation且不得Start。Start失败不回滚已经成功的Save/Create。

### Production Macro CRUD与clipboard Copy

.034一次性注册最终user-global Macro API：

    GET    /api/templates
    POST   /api/templates
    GET    /api/templates/:templateId
    PUT    /api/templates/:templateId
    DELETE /api/templates/:templateId

create body exact为：

    {
      "definition": {
        "schemaVersion": 3,
        "name": "Two terminals",
        "description": "",
        "terminalLayout": [
          { "index": 1, "type": "shell" },
          { "index": 2, "type": "text" }
        ],
        "body": []
      }
    }

create body exact为{ definition }，不携带record lease；update body exact为{ expectedRevision, editLeaseId, definition }；delete要求If-Match current revision与X-Shell-Deck-Content-Edit-Lease。三类mutation都还必须携带.033的Room controller context/headers。server生成id/revision/timestamps并返回MacroRecord。API不挂在Room path下，但必须从server-verified caller context确认controller；不接受record metadata、configId、body roomId、terminal mapping或unknown field。

Update/Delete逐字消费.033的published commit boundary。record atomic publish一旦成功，即使随后lease-state refresh/release失败，route也必须返回并广播authoritative saved/deleted结果，同时以`leaseOutcome.kind = "lost"`明确降级当前Edit session；不得把已经durable的revision/delete伪装成HTTP失败。Macro client安装authoritative record truth、清除失效lease并转read-only，保留可Copy内容和stable warning；只有`leaseOutcome.kind = "retained"`才继续原Edit session。Create仍在canonical record transaction内执行controller beforeCommit guard。

不存在/api/templates/:templateId/duplicate、/clone或任何copy-and-create route。旧/api/configs/:configId/templates/:templateId/duplicate连同config-scoped Macro API删除，不redirect、不alias。

Macro selector删除Duplicate按钮；client API/store删除duplicate方法。JSON view的Copy只执行navigator.clipboard.writeText：

* read-only preview复制当前显示的canonical pretty-printed MacroDefinitionV3。
* JSON Edit复制当前编辑buffer原文，即使尚未Save；Copy本身不validate、不写server。
* 两种情况都不包含MacroRecord wrapper、id、revision或timestamps，不创建record，也不改变selection/dirty/revision。
* navigator.clipboard Promise resolve后才可短暂显示Copied；reject时不得显示/保留Copied，显示stable clipboard_write_failed。成功或失败都不改变record count、selection、draft、dirty、revision、lease或operation generation。
* 创建相似Macro的唯一显式路径是New → JSON Edit → browser Paste → Save；Save走正常create validation和fresh MacroRecord identity。
* 删除Macro JSON Import/Export按钮、file picker、download与对应client helper；JSON Edit中的browser clipboard Paste不是产品Import API。

Library由.035遵守同一语义：Copy只复制content，禁止Duplicate/Import/Export。

### Terminal runtime 与动态 binding

Room 对本任务暴露：

    type RoomTerminalPosition = {
      index: number
      type: shell | text
      terminalId: string
      launchId: string
      readiness: ready | starting | exited | failed
      cwd?: string
    }

real/fake backend 映射为 shell；text backend 映射为 text。fake 只用于 tests/developer，不进入 Macro schema。cwd 只属于 live Shell runtime，text 没有 cwd；schema、Prepare 和 readiness comparator 不比较 cwd。

每个live Room维护monotonic terminalStructureRevision。只有会改变Macro index -> physical target binding的authoritative变化成功commit时递增：terminal create/insert/delete/reorder/type replacement、terminalId集合变化，以及restart/relaunch生成新launchId。readiness在starting/ready/exited/failed之间变化不递增terminalStructureRevision；它仍必须更新authoritative position snapshot、广播lifecycle event并触发UI/runtime validation。input/output、Text正文、Shell内cd/cwd、viewport、scroll、selected tab和其他纯UI状态同样不递增。active-run structure lock acquire/release不改变terminal binding，因此不递增terminalStructureRevision，但两次变化都必须推进Room级roomRevision并广播authoritative lock truth。

readiness映射只有一处：

* Shell spawn已接受但process尚未ready：starting。
* Shell process已进入可输入running状态：ready。
* Shell正常退出、被关闭或process已不存在：exited。
* Shell spawn/restart失败：failed。
* Text terminal创建成功后立即ready，直到被删除；Text不进入starting/exited/failed。

failed Shell create不得把一个不可用对象插入ordered collection；Prepare返回失败和最新authoritative snapshot，已经成功的keep/move/create仍保留。restart保留terminalId、生成新launchId，并在该binding commit时把terminalStructureRevision递增一次；随后starting/ready/exited/failed只更新readiness并广播，不再次改变structure revision。

terminalId、type、cwd 与 process 跟随 terminal 对象。index 是 server-authoritative ordered collection 的 1-based 位置，每次 authoritative snapshot 实时导出 index/type/terminalId binding。拖拽、插入、删除后受影响 index 立即更新；terminalId 不变。reset/relaunch 保留 terminalId、生成新 launchId。

唯一发送路径：

1. MacroDefinitionV3 保存 required index/type。
2. selection/readiness在Room queue内读取live binding与terminalStructureRevision。
3. Prepare request携带当前draft的canonical terminalLayout snapshot与expectedTerminalStructureRevision；Start request携带expectedMacroRevision与expectedTerminalStructureRevision。
4. Prepare不读record；Start在structure lock内复核两个revision，读取最新order，按index找terminalId并复核type/readiness。
5. Start把完整validated definition、record revision、configured index/type、terminalId、launchId、terminalStructureRevision与Room generation冻结到memory-only snapshot。
6. Action用configured terminalIndex查询snapshot，再按frozen terminalId发送。
7. 禁止Action执行时按live index重新查terminal或重读MacroRecord。

Trace 同时记录 configuredTerminalIndex 和 action 时 currentTerminalIndex；后者只用于解释位置变化，不参与 routing 或 Resume。

terminal runtime不再有alias、rename或可编辑title。本任务不得另定义terminal label；tab与pane header逐字消费.032已冻结的canonical `index · terminalId · [live cwd ·] kind · status`单行label、ellipsis/title和header selectable行为。launchId只进入runtime detail/evidence。

### Action capability

普通 terminal-bound Action 使用 required positive terminalIndex：send、input、terminal-quiet wait，以及 terminal-buffer、text-box、agent-event capture 对应 capture object。duration/user-continue wait 等非 terminal Action 不得携带 terminalIndex。

Parallel lane 使用 lane-level terminalIndex；lane 内 terminal-bound Action 继承，不重复保存。不同 lane 必须指向不同 layout index，并按 type 校验 lane 内容。

capability matrix：

* shell：send、input、terminal-quiet、terminal-buffer、agent-event。
* text：send、input、text-box。

每个 terminalIndex 必须存在于 terminalLayout。Definition 不接受 terminal、TerminalTarget、terminalId、alias、cwd 或 action-local terminal type。

Visual editor不展示`Terminal layout` section、Add Shell/Add Text或任何独立slot管理UI。`terminalLayout`是portable definition中的后台派生结构，不是用户需要单独维护的第二份前台状态；JSON editor仍按current schema显示和编辑它。

Visual editor内所有terminal-bound selector必须复用同一live-terminal projection与selection-state renderer，覆盖普通Send/Input、terminal-quiet Wait、Capture source与Parallel lane。projection只来自authoritative live Room positions，统一显示`N · shell`或`N · text`；不得增加`Room`、`Macro slot`、terminalId、cwd等内部来源后缀。

selector绝不能因terminalLayout为空、保存的terminalIndex已不存在、capability不匹配或全部terminal被其他lane占用而显示空白：没有live terminal时显示`No terminals available — create a terminal first`；Action当前index在live Room存在但尚未由该draft确认时显示`Choose terminal N to confirm this target`；失效或type/capability不匹配时显示`Missing terminal N`或`Terminal N changed type`，没有兼容terminal时还必须明确显示`no compatible terminals available`。

用户显式选择live terminal时，client在同一次visual draft mutation中先用authoritative Room position确认该Action或Parallel lane的terminalIndex/type，再把当前layout尾部到所选index的完整连续prefix复制为纯`index/type`。例如当前layout为`[1:shell]`、Room为`[1:shell,2:text,3:shell]`时选择3，结果必须是`[1:shell,2:text,3:shell]`；不得只追加3形成gap。该操作不保存terminalId、launchId、cwd、readiness或Room identity，不调用Prepare、不修改Room、不隐式Save。中间index缺失、当前layout本身非法或terminal已在选择前消失时整次选择失败并让native select回滚。

每次visual draft mutation结束后，client递归扫描普通Send/Input、terminal-quiet Wait、Capture source、Parallel lane及全部nested Flow body的实际terminalIndex引用，并把`terminalLayout`尾部裁到最高仍被引用的index；删除Action/lane、把Wait切回非terminal mode或把target从高index改到低index时，不再需要的尾部必须立即删除。因为schema要求连续prefix，中间未直接引用的index仍作为到最高引用位置的结构依赖保留。visual editor不得根据New shell/New text、terminal删除、重排、readiness或其他terminal event新增、删除或改写layout。

该reference-driven authoring对New draft和持有edit lease的saved Macro Edit使用同一规则；read-only selected Macro与observer因editor inert不能修改。新增terminal-bound Action时，如果Room已有兼容terminal，默认选择第一个并在同一次插入mutation中确认引用；如果Action先于Room terminal创建，后续terminal event只让选项出现，target保持未确认，用户必须显式选择。JSON buffer保持纯文本语义，不读取Room或自动派生。

Room terminal后续删除、重排或type变化只能刷新selector与runtime validation，不得反向改写Macro definition、Action target或既有layout。禁止New-draft seed、持续mirror、按terminal event自动追加，以及任何alias、migration或兼容分支；最终合法性仍由唯一definition validator判定。

### Visual authoring允许非线性与临时invalid中间态

Visual editor是可乱序搭建的draft editor，不是强制用户按最终执行顺序从头写到尾的wizard。结构mutation的admission只检查目标body/branch/lane是否允许该节点类型，不得因为当前语义依赖尚未闭合而拒绝Add、Add before、Add after、Add inside、Move或分支创建。执行依赖属于validation与Start gate，不属于编辑顺序gate。

因此用户可以先插入依赖前值的If，再通过`Add before`创建Capture、Parallel或Extract，或把已有producer移动到If之前，最后为condition选择source。每次mutation后重新计算exact predecessor scope和validation；未闭合期间draft可以标红并保持可编辑，但`Start`必须禁用，不能撤销刚完成的结构mutation、自动创建producer、自动重排节点或猜测引用。这一原则同样适用于Elif、root/nested Extract与Parallel lane Extract，以及后续其他“结构已合法但语义引用未完成”的visual authoring场景。

该编辑原则不改变durable MacroRecord边界：Save与JSON commit仍必须通过本task唯一current-schema definition validator。invalid draft可继续编辑但不能提交为saved record；合法saved record仍是Start的必要条件。

Visual editor创建If/Elif或Extract时必须始终完成结构插入。只能从该插入位置按执行顺序可见的earlier compatible artifact中选择默认source，并默认使用最近的一个。若当前scope没有更早的Capture、Parallel merged output或Extract output，新节点/分支保留editor-only未选择source：candidate使用空stepId占位，selector显示`Select an earlier artifact`，统一definition validation在对应`source.stepId`报错并阻止Save/Start，用户仍可继续编辑或稍后显式选择source。该占位不是合法saved schema；不得猜测`capture_1`、引用后续/兄弟branch输出或因source缺失撤销用户的插入。Parallel lane内Extract遵循相同规则，只可见outer earlier artifact与该lane中位于插入点之前的local output。

### Macro面板显式 Prepare terminals

Settings面板不得显示或保存`Auto-prepare terminals`、`autoPrepareTerminals`或等价开关。Macro selection始终client-local；New、selection、首次Save、普通Save、Edit、JSON Copy/Paste、reload、remote refresh、JSON commit/cancel、.035 Library Load、terminal mutation、lifecycle event和Start全部零Prepare。visual selector显式选择live terminal只是browser-local authoring mutation，不是Prepare/resolver，也不改变这一规则。不存在selection/load/event-triggered resolver。

Macro运行控制区把文字按钮`Prepare terminals`放在`Start`左侧，与layout readiness状态相邻；它是具体语义操作，不图标化。button busy文案为`Preparing…`。只有用户点击该按钮才调用resolver；终端已匹配时仍可点击并得到幂等ready response。

按钮读取当前正在显示的draft，而不是MacroRecord：

* visual editor/New/dirty/saved read-only：调用`validateMacroTerminalLayout(draftDefinition.terminalLayout)`。
* JSON Edit：对当前buffer调用`parseAndValidateMacroTerminalLayoutFromDefinitionJson`；不得读取saved/base/last-valid definition作为fallback。
* 完整Flow body或其他definition字段错误不阻止layout-only Prepare，但仍按正常规则阻止Save/Start。
* Prepare不Save、不Create/Update MacroRecord、不取得content edit lease，也不改变selectedRecord/base revision/dirty状态。

没有当前draft、JSON无法解析、terminalLayout缺失/非法、非Room controller、Room断连、已有lock-sensitive pending或active run structure lock时按钮disabled并显示对应tooltip/status。New和dirty draft只要layout合法即可Prepare；不要求tmpl_ identity、clean或saved revision。foreign/lost content edit lease本身不阻止以当前只读buffer Prepare，因为该操作不写content，但仍要求Room controller。

点击时client捕获terminalLayout canonical snapshot、draftRevision、operationGeneration、selection identity、controller epoch与expectedTerminalStructureRevision，并让当前draft/JSON buffer、selector、button及其他lock-sensitive入口inert；button重复点击和selection overlap不允许。server response携带的完整Room snapshot只在browser尚未初始化Room truth或其`roomRevision`严格大于已观察revision时安装；equal/older snapshot不得覆盖structure lock或其他Room级字段。terminal-specific event只有在launchId/terminalRevision stamp被接受时才能更新readiness/position；较新的WebSocket terminal/output/text event不能被延迟HTTP response回滚。无论snapshot是否因stale被拒绝，只有client operation identity仍匹配时才更新该Macro的operation notice，并按当前authoritative Room重新计算readiness。Prepare成功或失败都不改变draft/record。

client operation guard、.033 Room controller、.032 lifecycle ticket与server Room structure queue共同串行化Prepare。选择/切换Macro只重新validation，不请求resolver。产品不显示Use in this Room、Activate或Start-and-prepare，也不存在第二个Prepare入口。

### 集中 validation 与错误 UI

validation invalidation 必须覆盖所有可能改变 terminal binding 或可运行性的事件：

* selected MacroRecord id/revision/definition terminalLayout变化。
* Room generation或terminalStructureRevision变化、WebSocket reconnect后的authoritative full snapshot。
* terminal create/new/insert、remove/delete、drag/reorder。
* reset/restart/relaunch、launchId 变化。
* backend lifecycle 的 starting、ready、exited、failed。
* .033当前Room controller完成的mutation或controller takeover。
* 显式Prepare成功、部分成功或失败后的final snapshot。

terminal input/output、Text content、Shell 内 cd、viewport resize、tab selection 和 scroll 不触发 layout validation。

validation 读取最新 Room snapshot并比较前 N 个 index/type/readiness；extra terminal 与 cwd 忽略。结果精确分为：

* checking：正在等待 authoritative snapshot。
* mismatch：missing 或 type 不一致，stable code 为 macro_terminal_layout_mismatch。
* not-ready：index/type 一致但至少一个 readiness 不是 ready，stable code 为 macro_terminal_not_ready。
* ready：所有 required position 的 index/type/readiness 均通过。

UI 必须：

* 在引用该terminal的Action/Lane selector及Macro运行状态区显示expected/actual诊断，并对missing/type/not-ready项标红；不得为此恢复独立Terminal layout前台section。
* checking/mismatch/not-ready 时禁用 Start。
* runner status 区域显示 stable code，并提示用户检查、新建、移动、等待或 restart terminal。
* 在Start左侧显示唯一`Prepare terminals`按钮；不在Settings、selector、Library或其他位置复制入口。
* 不把 selected Macro readiness 写入 Room runner state。
* server Start API独立复核，不能信任 client。

遗漏广播不能突破安全边界；Start 必须在 structure lock 内读取 authoritative state。

### 显式 Prepare operation

唯一 resolver route 为：

    POST /api/rooms/:roomId/terminals/prepare
    body: {
      terminalLayout,
      expectedTerminalStructureRevision
    }

这是Macro面板`Prepare terminals`按钮的唯一operation。client只从canonical /<roomId>构造path；body exact为`{ terminalLayout, expectedTerminalStructureRevision }`，不接受roomId、templateId、MacroRecord revision、definition/body、cwd或auto flag。server先调用唯一`validateMacroTerminalLayout`，再按.033统一guard取得.032 generation-bound active Room lifecycle ticket并验证Room controller，最后在Room structure queue入口复核terminalStructureRevision。它不读取shared Macro store或client draft。ticket必须覆盖queue wait、全部backend await与final publish。layout非法返回invalid_terminal_layout；terminal revision不匹配返回terminal_structure_revision_conflict；两者都必须在任何terminal mutation前失败且零mutation。

resolver 在 Room structure queue 内按 terminalLayout 1..N 从左到右：

1. index i 已有相同 type terminal：固定该对象，不考虑 readiness。
2. type 不同或位置缺失：在 i 后方寻找最近且尚未固定的相同 type terminal，不考虑 readiness。
3. 找到时按 terminalId 移到 i；被跨过对象保持相对顺序。
4. 找不到时，shell 创建 cwd=$HOME 的 real PTY，text 创建 Text terminal，并插入 i。
5. 完成后返回authoritative final terminalStructureRevision与positions；不返回或伪造MacroRecord identity/revision。

resolver只解决结构。它不等待starting，不restart exited/failed，不创建readiness替代对象，不close/delete/reset/rebuild terminal，也不触碰extra terminals。新建对象可先处于starting；后续lifecycle event再更新validation。

V0不做terminal capacity preflight或terminal数量拒绝。resolver按definition顺序工作，直到完成或真实backend/OS资源操作失败；不得返回terminal_capacity_reached，也不得因terminalLayout超过某个常数而拒绝portable definition。通用request bytes/JSON parser防护不改变该语义。

真实backend create/move中途失败采用简单fail-visible语义：立即停止本次resolver，不执行剩余计划，返回terminal_prepare_backend_failed、失败operation/index以及最新authoritative terminalStructureRevision/positions。此前已经成功的keep/move/create/insert保留，失败create本身不插入terminal；不建立staging collection，不rollback，也不自动清理/重排已有runtime。client必须用response snapshot替换旧视图、解除draft/selector/button lock、重新运行validation并保持Start disabled，提示用户手动create/move/restart后再运行。该partial failure只属于已通过入口revision检查后的真实backend错误；invalid_terminal_layout或terminal_structure_revision_conflict仍必须在第一项Room mutation前返回并保证零mutation。

每次PTY/Text create、move或其他await返回后，以及insert/move/final snapshot publish前，resolver必须复核lifecycle ticket、roomGeneration、controller epoch与queue ownership。Room进入destroying时返回.032 room_destroying，cancel尚未执行的plan；已spawn但尚未insert的terminal/process必须立即清理，绝不插入destroyed map。此前已commit的partial layout不rollback，由Destroy统一终止；Room已从map移除时不伪造authoritative positions，client转到Room destroyed/Home状态。Destroy等待该ticket确认退出后才移除runtime。若Room仍active但controller epoch/lease改变，使用相同资源清理边界返回room_control_lost；已commit的partial layout保留并返回最新authoritative snapshot，不能由旧controller继续剩余plan。

Prepare一旦在queue内捕获request terminalLayout canonical snapshot，任何本地draft或远端MacroRecord后续变化都不能改变本次plan；它从不重读record。active run structure lock阻止显式Prepare并返回room_structure_locked_by_run。draft/JSON buffer、selector与button保持锁定直到final response；Room不被修改的失败也必须解除lock并显示stable code。

### Start validation 与 run snapshot

Start route：

    POST /api/rooms/:roomId/runner/start
    body: {
      templateId,
      expectedMacroRevision,
      expectedTerminalStructureRevision
    }

first-party client只从 canonical /<roomId>构造 path。Start 固定顺序：

1. 按.033统一guard取得.032 generation-bound active Room lifecycle ticket并复核Room controller、roomGeneration与request exact keys；ticket覆盖structure queue、store read、manifest/event await和in-memory publish。
2. 在目标Room structure queue中取得exclusive tentative run structure lock；已有active run则失败。
3. 复核current terminalStructureRevision与expectedTerminalStructureRevision；不一致返回terminal_structure_revision_conflict。
4. 从.032 user-global store读取templateId的current record；revision必须等于expectedMacroRevision，否则返回macro_revision_conflict。
5. 调用唯一portable validator并要求ok=true，取得immutable MacroDefinitionV3 value；再读取serverInstanceId、roomId、roomGeneration、ordered terminals并执行capability/index/type/readiness validation。
6. mismatch/not-ready时返回对应stable code并释放lock；零terminal mutation、零run、零step。
7. ready时冻结完整canonical MacroDefinitionV3、definition hash、record id/revision、terminalStructureRevision、configured index/type、terminalId、launchId与Room generation。
8. 创建run_ ID，按下述durable bootstrap依次发布manifest、run_started与in-memory run；每个await后和publish前复核lifecycle ticket/generation/controller epoch，全部成功后才返回Start成功并进入第一个step。

Start不得调用Prepare route/service，也不得内联keep/move/create；不存在setting、selection或Load改变这一点。

expectedMacroRevision识别调用者实际看到的saved版本。Start捕获该exact revision后，另一个Room后续保存新revision不影响当前run；runner在任何step、Resume或branch都不得重读MacroRecord。Action只按frozen snapshot routing。frozen terminal缺失、自然退出、type异常、launchId失效或Room generation变化时fail loudly并留evidence，不自动绑定当前位置的新terminal。

唯一持久化manifest schema使用exact keys：

    type RunManifestV1 = {
      schemaVersion: 1
      runId: string
      createdAt: string
      macroRecord: { id: string; revision: number }
      definition: MacroDefinitionV3
      definitionHash: { algorithm: "sha256"; value: string }
      runtime: {
        serverInstanceId: string
        roomId: string
        roomGeneration: string
        terminalStructureRevision: number
      }
      terminalBindings: Array<{
        index: number
        type: "shell" | "text"
        terminalId: string
        launchId: string
      }>
    }

definitionHash对validated definition执行唯一canonicalJsonStringify：object keys按Unicode code-point升序递归排序、array order保持、无额外whitespace，再对UTF-8 bytes计算SHA-256并输出lowercase hex。manifest用same-filesystem temp、fsync与atomic publish写入runs/<runId>/manifest.json；不存在另一个hash/pretty JSON算法。

bounded durable event tail与permanent summary共同构成run lifecycle evidence；manifest只是immutable attachment，不因文件存在就代表run已启动。event按100条segment保存，V0最多保留最近1000条且删除最旧完整segment；eventSeq保持绝对单调，`summary.json`永久记录first/last/total/discarded与last kind，artifact不随event retention删除。durable bootstrap顺序固定为：

1. 在tentative structure lock内生成完整snapshot和manifest，atomic publish manifest；失败则返回run_manifest_write_failed、零run_started、零in-memory run并释放lock。publish await后若lifecycle ticket已abort，不append run_started，best-effort删除unreferenced manifest并以room_destroying退出。
2. 初始化该run event log并append run_started；event携带manifest相对ref、definitionHash与terminalBindings摘要。append失败则返回run_event_append_failed、零in-memory run并释放lock；unreferenced manifest不出现在Trace并由best-effort cleanup删除。append await后若Destroy已进入destroying，绝不安装in-memory run；尽力append run_failed(code=room_destroyed_during_start)，失败时Trace按既有run_started无终态规则显示interrupted，然后释放ticket/lock。
3. run_started成功且ticket复核仍active后，以无await的同步commit安装in-memory run/cursor/snapshot并把tentative lock转为active-run lock，再返回Start成功并调度第一step。lifecycle state check与in-memory install必须位于同一Room admission critical section，不能在两者之间yield。若同process安装失败，尽力append run_failed(code=run_bootstrap_failed)并释放lock；若在run_started后crash或终态append也失败，Trace按event log派生interrupted。

Destroy不等待structure lock才关闭admission；它按.032先active -> destroying并abort ticket，再等待Start确认上述边界。故manifest publish、run_started append或in-memory install任何forced interleaving都只能得到以下一种结果：Start在Destroy前完整commit后由Destroy终止active run，或Start看见abort且不安装run；绝不允许Room移除后安装runtime。durable evidence可以保留，但不能变成Resume输入。

controller takeover/disconnect发生在durable bootstrap中时使用同样的commit规则但Room保持active：manifest publish后、run_started前发现epoch/lease失效则删除unreferenced manifest并返回room_control_lost；run_started已commit后发现失效则不得安装run，尽力append run_failed(code=room_control_lost_during_start)。controller recheck与同步in-memory install之间同样不得yield。

terminal action evidence引用runId与frozen mapping；cwd、action时currentTerminalIndex可作为provenance，但不得用于routing/readiness/Resume。Pause/Resume只操作当前process、roomId、roomGeneration中的live in-memory run/cursor/executable snapshot。server restart或Destroy后Resume返回run_not_active；Trace对缺少终态的旧run显示interrupted且不展示Resume。任何path都不得从manifest/event log反序列化cursor、definition或terminal snapshot来恢复runner。

runner必须在固定node/iteration budget内执行cooperative macrotask yield；仅`await`立即resolve的Promise不算yield。每次yield后先重新检查abort与pause，再执行后续节点，因此合法`forever`、空body或`continue` tight loop不能饿死HTTP、WebSocket、timer、Pause或Stop。

`terminal-quiet`按frozen terminalId/launchId的单调`outputActivityRevision`判断活动，不得比较可能被截断到固定大小的replay长度；tail已满时持续等长输出仍然不quiet。Input提交采用durable-first边界：先append `runner_input_submitted`，成功后才清除pending input、切回Running并resolve Action；append失败保留原prompt、draft、revision和resolver，可由用户重试或Stop唤醒，绝不能卡死在Stopping。Pause/Resume/Stop与run终态同样不得先发布相互矛盾的内存终态；每个run最多有一个terminal event，终态后不再追加step event。

live run在内存维护immutable provenance、next event sequence和bounded event window。正常append只写新增JSONL event，不能为每个event重新读取并parse segment或完整run；只有冷读、ambiguous publish reconciliation或幂等retry检查bounded segment。完整line已发布但后置fsync/summary checkpoint失败时，以相同sequence和event intent核对tail并幂等成功或允许安全重试，不能生成重复eventSeq；partial final line必须在下一次read/append前截断。summary在start、segment边界、retention推进和terminal event checkpoint，并能从首尾segment修复stale派生值。该约束与1000条retention共同避免长run/forever run的无界内存、磁盘和确定性O(n²)路径。

### Active-run terminal structure lock 与 Destroy 例外

lock 状态：

* held：Starting、Running、Paused、Stopping。
* released：Start validation失败，或 run进入 Completed、Failed、Stopped。

lock 期间 UI disabled/inert，server endpoint 返回 room_structure_locked_by_run：

* terminal create/new/insert、close/remove。
* drag/reorder 和任何 index mutation。
* reset、restart、backend/type replacement。
* 显式`Prepare terminals`。

Pause 不释放 lock；Stop 进入 Stopping 仍持有，直到 Stopped。解锁后不自动重放此前失败的操作。

Destroy Room是唯一结构锁例外。它只由.032 Room Home发起，携带目标roomGeneration并按lifecycle management contract执行，不要求、获取或接管目标Room controller。server先把目标Room原子标记为destroying并关闭lifecycle admission，abort/cancel/drain Prepare、Start与runner operation ticket，再终止active run、kill terminals、通知clients并删除registry entry；Destroy不等待或取得structure lock，也不返回room_structure_locked_by_run。Ctrl+C/SIGTERM无需browser controller并走同一destroy-all lifecycle。

selected tab、scroll、viewport resize、普通 input/output、Shell 内 cd、关闭 browser、WebSocket disconnect，以及在Room Home执行New/Open，不属于当前Room structure mutation。terminal 自然 exited/failed 不能被 UI lock阻止；它会让 run Action失败并保留 evidence。

### 同用户多设备边界

同一个用户可通过多个tab或设备连接同一Room并同步观察；.033保证只有controller可执行Prepare、Start、terminal structure与Macro content mutation，observer的server请求fail loudly。Setting、selected Macro、draft/collapse等client-local state可各自不同；Room terminal与run是server-authoritative。

saved Macro编辑另受.033 per-record lease保护，因此不同Room/process也不能同时编辑同一record。read/Copy以及按saved revision Start不要求取得content edit lease；Edit/Save/Delete必须取得。controller takeover、content lease loss或record revision变化都会使pending Save/Start在commit前失效。

### Legacy Kill List

实现后必须删除或不可达：

* Macro schemaVersion 2、definition内record metadata、top-level configId/projectId/roomId/cwd。
* config-scoped/user-global duplicate或clone route、Macro selector Duplicate按钮、client/store duplicate方法与任何copy-and-create分支。
* JSON Import/Export按钮、file picker/download helper或任何绕过normal New/Paste/Save validation的入口。
* TerminalTarget index/id/alias union、terminal physical ref、terminal alias/rename/title editor。
* Use/Activate、Start-and-prepare、Start-triggered resolver，或除Macro面板`Prepare terminals`外的第二入口。
* Save读取Room terminal、因mismatch/not-ready失败或触发Prepare的分支。
* Prepare读取MacroRecord/要求expectedMacroRevision，Prepare缺terminalLayout snapshot/expectedTerminalStructureRevision，Start缺expectedMacroRevision/expectedTerminalStructureRevision，或用泛化roomRevision冒充terminal structure version。
* terminal lifecycle reactive repair、starting bounded wait、failed/exited replacement/restart。
* active run期间绕过lock的create/delete/reorder/reset/restart/显式Prepare。
* 把 Destroy Room 当普通 structure mutation而阻止的分支。
* Action-time live index resolver、step-time MacroRecord reread、active run retarget。
* persisted runner/cursor/executable snapshot、manifest/log replay Resume；允许只读RunManifestV1 evidence。
* Macro editor/client/Library/runner各自复制的validator、Library宽松Macro语法或client-only edit lock。
* JSON editor、Library或server caller在gateway外直接JSON.parse Macro文本、解析native parser message，或自行生成invalid_json position/definition issue code。
* MAX_TERMINALS_PER_ROOM、terminalLayout length cap、terminal_capacity_reached或借Room count上限限制Room内terminal数量。
* migration、dual schema、converter、fallback alias和旧 fixture positive path。

历史 snapshot 可记录旧事实；current source/tests/active docs只描述 current contract。

## 示例

### Definition 与 Record 分层

Macro editor JSON：

    {
      "schemaVersion": 3,
      "name": "Two terminals",
      "description": "",
      "terminalLayout": [
        { "index": 1, "type": "shell" },
        { "index": 2, "type": "text" }
      ],
      "body": []
    }

server 持久化 response：

    {
      "id": "tmpl_73WakrfVbNJBaAmhQtEeDv",
      "revision": 4,
      "createdAt": "2026-07-14T00:00:00.000Z",
      "updatedAt": "2026-07-14T01:00:00.000Z",
      "definition": {
        "schemaVersion": 3,
        "name": "Two terminals",
        "description": "",
        "terminalLayout": [
          { "index": 1, "type": "shell" },
          { "index": 2, "type": "text" }
        ],
        "body": []
      }
    }

Definition 和 Library content都没有 tmpl_、revision或timestamps；terminalLayout也没有 terminalId。

### Copy而不Duplicate

用户在read-only JSON preview点击Copy，clipboard得到当前MacroDefinitionV3 JSON，不含tmpl_、revision或timestamps；Macro list、store和selection完全不变。用户需要相似Macro时点击New，进入JSON Edit后使用browser Paste并Save，server通过正常POST创建fresh MacroRecord。产品没有Duplicate、Import或Export。

### Save不依赖Room

当前Room为空，用户New并在JSON draft写入要求[1:shell, 2:text]的definition。无需先Save，点击`Prepare terminals`即可按当前draft layout创建terminal；draft仍dirty且没有record identity。随后首次Save成功创建MacroRecord并取得fresh record edit lease，继续保持Edit session；它不再次Prepare，也不因Room mismatch失败。Visual editor没有独立Terminal layout输入区；其layout只由实际Action target选择派生。Start只运行saved revision并独立校验。

### 显式Prepare、手动变化与 lifecycle

Room为[1:shell(term_A), 2:text(term_B)]，当前dirty/New draft要求[1:text, 2:shell]。切换Macro和编辑draft都只刷新validation；用户点击`Prepare terminals`后，client锁定当前draft/JSON buffer、selector和button，发送layout snapshot与terminalStructureRevision，resolver移动term_B得到[term_B:text, term_A:shell]后才解锁。Prepare不Save draft。

用户随后删除 term_A。系统立即把 index 2 标为 missing并禁用 Start，但不补回。用户自行新建 Shell 后，它处于 starting，UI显示 macro_terminal_not_ready；程序不等待或restart。收到 ready event后自动重新校验为 ready。

starting -> ready只改变readiness并广播，不递增terminalStructureRevision，因此不会让忽略readiness的在途Prepare无故产生structure conflict；Start仍在structure lock内读取最新readiness，若此时terminal又exited则authoritative返回macro_terminal_not_ready。

切换到任何Macro或Library Load都不触发Prepare，只显示mismatch。用户可以再次点击同一个draft的`Prepare terminals`幂等修复，也可以自己拖拽terminal；没有Settings toggle、Use/Activate或第二Prepare按钮。

### Frozen routing 与 Destroy

Start把exact record revision的完整definition与index 1/2到term_B/term_A的mapping冻结。另一个Room随后把该Macro保存为新revision，当前run仍执行旧snapshot；Action只按这两个ID发送。Paused期间拖拽、delete、restart仍禁用。用户可在Room Home按目标generation执行Destroy；它无需接管目标controller，Room终止run和terminal并消失。旧RunManifest/Trace可读，但Resume返回run_not_active。

### 失败反例

* Start面对 mismatch或not-ready：不移动、不创建、不restart terminal。
* terminalLayout为 [1:shell, 3:text]：schema error。
* text-box capture指向 shell layout：capability error。
* Definition带record id、cwd、roomId、terminalId或alias：schema error。
* 请求duplicate/clone/import/export route或UI：不存在；点击Copy后Macro数量变化属于测试失败。
* Save合法definition但当前Room缺terminal：Save成功，不能返回runtime mismatch。
* Prepare的expectedTerminalStructureRevision过期：terminal_structure_revision_conflict且零mutation；Start的Macro或terminal revision过期：对应conflict且零run。
* active run期间仍可切换Macro/编辑local New draft，但点击`Prepare terminals`返回room_structure_locked_by_run。
* server restart后对旧manifest/log Resume：run_not_active。
* terminalLayout包含33项或更多：不能仅因数量返回schema/capacity error；fake backend可以完整Prepare，real backend资源失败则返回terminal_prepare_backend_failed与实际state。
* Destroy与Prepare/Start await交错：返回room_destroying或完成后立即被Destroy，绝不能在Room map删除后插入terminal或安装run。

## 测试规范

### Unit

* MacroDefinitionV3 exact keys、continuous/empty/unbounded terminalLayout、MacroRecord envelope分层、Flow semantic id例外，以及唯一gateway的exact discriminated result、closed issue-code registry、stable issue path/code/message、排序与去重。
* shared `validateMacroTerminalLayout`被full definition与Prepare request共同调用；`parseAndValidateMacroTerminalLayoutFromDefinitionJson`只消费当前JSON buffer、复用同一invalid_json UTF-16 position且忽略非layout字段错误，不允许last-valid fallback或第二套layout规则。
* parseAndValidateMacroDefinitionJson对browser/server共用：invalid_json exact union、UTF-16 offset与1-based line/column（含CRLF/EOF）、invalid_macro_definition issues，以及caller无native JSON.parse/error-message分支。
* final CRUD exact routes/bodies、controller/editLeaseId/expectedRevision、fresh identity、Duplicate/Import/Export不存在，以及JSON Copy resolve/reject均零server/store/editor mutation。
* V2、record metadata、config/Project/Room/cwd、TerminalTarget/id/alias全部失败。
* editor selected/base/draftRevision/dirty/lease lifecycle、pending inert、await后stale response，以及dirty visual Start中Save/Create返回fresh identity/revision后的合法phase transition与真实并发变化阻断。
* Save portable-only：空Room/mismatch/not-ready均可Save，且Save/New不调用Prepare。
* terminal dynamic index/stable id、terminalStructureRevision只对binding变化递增、readiness transition不递增但触发validation、reset launchId恰递增一次、binding snapshot、Start一次解析与Action frozen-ID routing。
* Action terminalIndex/type/capability与Parallel inheritance/uniqueness。
* Send/Input/Wait/Capture/Parallel共用只显示`N · type`的live-terminal projection与selector state；显式选择会原子materialize连续index/type prefix并更新target，删除/降级引用会裁掉unused tail；terminal event零layout mutation，missing/type-changed/no-terminal均有非空placeholder，UI不存在Terminal layout section或`Room`后缀。
* If/Elif/Extract默认source只取当前插入点更早且scope-compatible的artifact；无source时仍插入并显示未选择占位，由validation阻止Save/Start。覆盖empty Root、nested For/If、Elif、branch scope、root Extract和Parallel lane Extract的无source编辑态，以及outer/local earlier artifact默认选择；不得猜测future或sibling source。
* New/selected/editing状态下selector与New保持可操作；Save及dirty Start后Edit session/lease保留、clean Done退出、New Create后fresh lease acquire与竞争失败read-only提示、dirty discard的accept/reject、native select回滚、lease release、New Discard、搜索固定current selection，以及read-only selected record直接Delete时内部acquire/takeover/revision/delete全路径。
* Settings/current browser schema无Prepare toggle；new Room null selection；唯一`Prepare terminals`按钮位置/busy/tooltip；New/dirty/saved/JSON draft layout source、last-valid禁止、selection/Load/Save/Start/event零触发、重复点击/selector serialization，以及Use/Activate/第二入口不存在。
* resolver keep、nearest same-type move、$HOME create insert、extra preservation、readiness ignored、no wait/restart/replacement、超过32项不触发人工capacity；真实backend中途失败立即停止、返回latest authoritative partial snapshot且不rollback。
* 全部 structure/lifecycle/reconnect/record invalidation事件与cwd/content/output non-event。
* Prepare layout/terminal revision validation、Start Macro/terminal revision conflict、stable errors、zero mutation、immutable full definition snapshot和lock transitions。
* exact RunManifestV1 keys、canonical JSON/hash、atomic publish与manifest/event/in-memory fault boundary；runtime-only Pause/Resume、Home lifecycle Destroy exception、restart run_not_active和interrupted Trace。barrier覆盖Destroy及controller loss与PTY spawn/insert、manifest publish、run_started append、in-memory install的forced interleaving。
* cooperative macrotask yield覆盖tight forever/continue，Stop/Pause与timer必须在deadline内获得调度；yield后重新检查abort/pause。
* terminal-quiet使用frozen launch的outputActivityRevision，覆盖replay tail满后持续等长输出，禁止replay length heuristic。
* Input submit event append fault保持waiting input可重试且Stop可收口；Pause/Resume/Stop/finish fault injection验证单一终态、无额外terminal write和structure lock释放。
* live EvidenceStore/MacroRunStore cursor使连续append零segment回读；大量event regression验证absolute monotonic sequence、ambiguous append幂等、partial-line恢复、100-event segment、1000-event retention、permanent summary、artifact保留与非O(n²) path。

### Integration / protocol

* user-global Macro CRUD接入.032 primitive与.033 controller/edit lease；config-scoped/Duplicate/Import/Export routes全部失败。
* canonical /<roomId> Prepare exact `{terminalLayout, expectedTerminalStructureRevision}`与Start exact version-bound body；malformed/unknown Room、invalid layout、stale terminal revision与Start stale MacroRecord fail loudly。
* 只有按钮click调用Prepare；selection、Library Load、New、save、reload、terminal mutation/lifecycle和Start均零调用，double click/pending/selection不能重叠。
* starting/exited/failed terminal只产生not-ready，不触发wait/restart/replacement。
* .033 controller、selector lock、operation generation、Room queue与structure lock共同阻断stale/overlap；Prepare/Start backend await期间takeover后旧operation停止，不能安装run或继续plan。
* Running/Paused/Stopping阻断全部 terminal structure endpoint，但Room Home的generation-bound Destroy始终可终止目标run，且不获取目标controller。
* Start不调用resolver，mismatch/not-ready不改变terminal list/terminalStructureRevision。
* active run按frozen full definition + generation + terminalId路由，不泄漏到其他Room，也不受record后续revision影响。
* RunManifest/evidence保存snapshot副本，但任何routing/Resume path都不读取它；manifest publish、run_started append与in-memory install逐点fault injection符合durable bootstrap。
* .032 lifecycle ticket在Prepare/Start完整操作期间有效；Destroy先关闭admission并abort/drain，queued/in-flight operation不能在map removal后publish，spawned-uninserted process被清理。
* 延迟Prepare HTTP response与更晚WebSocket terminal/output/text event交错时，roomRevision monotonic merge拒绝旧snapshot，current Room truth不回滚。
* Macro Update/Delete在record publish后lease-state fault仍返回并广播authoritative result；client清除lost lease、转read-only且不会把durable commit报告为失败。

### Browser E2E

* Settings与browser storage不存在Prepare toggle/field；Macro运行区在Start左侧显示唯一`Prepare terminals`文字按钮及`Preparing…`busy state。
* 新Room无selected Macro；New/dirty/saved read-only/JSON buffer的合法layout都可显式Prepare；invalid JSON/invalid layout、observer、pending和active run正确disabled/fail loudly。
* selection、.035 clean/dirty Load、Save、reload、terminal event与Start均零Prepare；UI不存在Use/Activate/Start-and-prepare或第二Prepare入口，也不存在Duplicate、Import或Export；JSON Copy resolve才显示短暂Copied，reject显示clipboard_write_failed且不改state。
* New → JSON Edit → browser Paste → Save创建fresh MacroRecord；空Room也可Save，Copy本身不改变Macro count、selection、dirty或revision。
* saved Macro显式Edit取得lease；另一Room/process只读，takeover或lease loss后pending Save不能commit。
* create/delete/drag/restart/starting/ready/exited/failed/controller mutation后正确标红或恢复。
* mismatch/not-ready时layout与runner status均显示错误、Start disabled；bypass request仍失败且Room不变。
* Running与Paused期间结构控件冻结；用户从Room顶栏Home按钮打开Room Home后，仍可按generation Destroy并清理目标Room。
* terminal tab与pane header保持.032 canonical index/full runtime id/可选live cwd/kind/status单行label，无alias/rename/title editor；Macro重构不得改写该terminal chrome。
* 同用户第二设备observer可选择/read/copy，但Prepare/Start/Edit由.033 controller guard；Take Control后旧页面立即只读。
* dirty New/Edit与JSON Edit在Macro panel隐藏再显示后保持原页面内存状态；clean页面不阻止unload，dirty/JSON Edit触发native unload确认，取消离开后draft不变，且任何业务draft都不进入browser storage。

### Gate 与残留扫描

* 新增just test-034，并先运行just test-032与just test-033。
* 运行just check、just build、just test-unit、test-032/033/034、受影响task Gate、browser Gate与git diff --check。
* rg扫描Macro V2、TerminalTarget、alias、Use/Activate、autoPrepare/Settings toggle、selection/load/event-triggered或第二Prepare入口、Duplicate/clone/Import/Export route/UI/client/store、copy-and-create、Save runtime dependency、Prepare record lookup/unversioned Prepare/Start、reactive repair、readiness healing、readiness递增structure revision、gateway外JSON.parse/native parser message、terminal count cap/capacity error、Destroy lock、Action-time index/live record lookup和persisted runner恢复。
* 只允许 .032 generated ID module生成 system opaque ID；旧格式只可出现在negative fixture或历史snapshot。
