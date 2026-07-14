# 20260627A.036 Problem Context

## 从Prompt面板到通用Library

现有Prompt面板只保存一种文本，但用户实际需要三类长期内容：可直接实例化的Macro JSON、常用Prompt和自由Note。Macro panel保存的是可编辑、可运行MacroRecord；Library保存可复用素材，两者使用方式不同。

此前Directory/Global设想依赖target working directory。.032已删除Project/目标目录产品模型；一个Macro还可以同时操作多个cwd的terminal，因此Library只有一个真正user-global collection，不随Room、selected Macro、terminal或cwd切换。

## 三种内容、一个交互模型

Library panel恰有三个tabs：

* Macro JSON：纯MacroDefinitionV3 JSON，提供行号、Validate和Load into Macro。
* Prompt：任意文本，主要保存常用提示词。
* Note：任意文本，主要保存用户笔记。

三类都支持统一CRUD、search、Copy和Refresh。saved detail默认read-only；显式Edit先取得.033 per-record lease。另一Room/process正在编辑同一item时，本页面仍可read/search/copy，但不能Edit/Save/Delete。不同item可并行编辑。

Copy只读取persisted或draft content并写入clipboard，不复制metadata、不调用server、不创建item。clipboard失败必须显示错误且不能显示Copied。创建相似内容使用New、browser Paste、Save；Library与Macro都不提供Duplicate、Import或Export。

## Macro JSON Library的边界

Library Macro JSON只保存.034 MacroDefinitionV3，不参与runner，也不与任何MacroRecord live-link。同一个source可反复Load，每次由.034 Macro store生成fresh tmpl_、revision 1和timestamps。Load是明确的domain action，不是Library Duplicate。

.034已经拥有唯一portable validator及stable result/issue contract；.036只调用它。JSON parse失败与definition validation失败保持分层，Library不能复制schema/token/capability规则、改写issue或定义“Library兼容模式”。Prompt/Note永远按普通text处理，即使内容是invalid JSON或包含双花括号也不进入validator。

Load source是只读saved revision，即使另一client持有该Library item的edit lease也可Load当前persisted content。Load不需要terminal，也不调用Prepare；成功创建MacroRecord后，client是否切换只由Macro editor request-time/response-time state决定。clean且未变化时切换，dirty或locked时只通知创建成功。即使自动切换成功也只刷新layout validation，用户必须在Macro面板主动点击`Prepare terminals`才修改Room。

## Identity、revision与lease

Library使用.032的<user-root>/library/<kind>/<itemId>.json、shared-store revision与generated ID module。Library canonical key是(kind,itemId)，不是itemId单独全局唯一；.033 content lease resource key也必须包含kind。

lease回答当前谁可编辑，revision回答保存基线是否有效。active editor的lease由owner server基于live Room WebSocket续期，browser timer/focus不负责renew。Save/Delete必须在.032由record规范化相对路径派生的同一个resource transaction guard内，同时通过Room controller、content edit lease和expected revision；lease transition与record commit不得各用一把锁，任一变化都零写入。Save更新lease的base revision并保留Edit session，Done/Cancel才退出。New在Create前没有existing record lease，server成功创建后返回fresh identity，client随后取得该fresh record lease才继续编辑。

相同User Data Root的多个server process共享Library内容和edit lease协调，但不共享Room runtime，也没有cross-process live WebSocket push。Refresh、focus或下一次read看到最新文件真值。

## Stable search

V0 search是server authoritative、无pagination的完整结果：q先trim；empty q返回kind内全部items；非空q对title、description、tags和content做case-insensitive substring匹配。结果稳定按updatedAt降序、itemId升序排列。client不再实现另一套只搜title或不同排序。

## Current-schema-only

旧Prompt files、scope field、Directory/Global routes、Library完整MacroRecord、source tmpl_、Duplicate/Import/Export与caller-local Macro validator全部非法，不扫描、不迁移、不兼容。

## 精准重构而非重新设计

.032的中间态删除了旧Prompt panel，这是schema cutover的阶段性结果，不代表产品否定此前已经打磨的workspace，也不授权.036凭空发明另一套面板。最终实现应从.031的`PromptPanel.svelte`与`WorkspaceShell.svelte`提取仍与current contract兼容的panel shell、header/status/reset-width关系、toolbar/editor层次、notice/error/dirty反馈和控件视觉语言，再接到.036的新Library state/API；.034形成的Macro/terminal区域则原样继承。

必须改变的是Prompts→Library命名、Macro JSON/Prompt/Note tabs、list/search/read-only/Edit/Save/Cancel/Copy/Remove/Refresh、lease/revision状态、Macro Validate/Load，以及旧scope和旧Prompt wiring的删除。可以为这些新状态局部调整布局与responsive行为，但不得顺手改变无关panel比例、Macro层级、terminal chrome、全局颜色/字体/图标或其他成熟交互。这里不要求截图或pixel一致；验收看行为、结构和每个偏离reference的明确任务理由。
