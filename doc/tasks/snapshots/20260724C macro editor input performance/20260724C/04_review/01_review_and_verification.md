# Review and Verification

## 结论

20260724C已完成。Macro Visual editor不再在每个按键上深拷贝并替换整份definition；Send/Notify/Parallel message text也不再复制整条message。Node ID不再直接或间接作为递归节点DOM key：Flow article以node object为identity，For(text-list) item row以item object为identity。Node、Parallel Lane/Action/Output四类ID均通过真实浏览器连续重命名、同一DOM、focus与caret断言；For父Node ID逐字符rename时，既有item card、key input与value textarea也保持原DOM和值。输入阶段没有Macro Create/Update请求，Save仍完全显式。

未发现未解决P1/P2。task spec、active spec、代码、focused测试、完整unit/integration/E2E及结构oracle一致，可以关闭。

## 落地映射

* `macroDraftMutation.ts`是22行的小型比较器，只缓存immutable base fingerprint；它不拥有draft或第二份可编辑状态。
* `macroRecordSession.svelte.ts`继续唯一拥有rune draft、base、dirty与revision。全部base安装点走同一helper；accepted Visual mutation直接作用于当前draft，再用缓存基线计算精确dirty。
* `MessagePartsEditor.svelte`把message mutation交回现有parent gateway，text/structure操作不再先做JSON stringify/parse。
* `MacroFlowNodeList.svelte`使用node object作为当前editor instance的稳定key；persisted ID仍只属于definition内容。
* `MacroControlNodeEditor.svelte`直接以text-list item object作为row key；`macroFlowTreeController.svelte.ts`删除按父Node ID维护的structure-version state与key helper，insert/remove/move继续原地操作唯一items数组。
* component-port变化没有改变DOM entry数量、control order或test id。current structure oracle精确更新相关component-port fingerprint，workbench总entry仍为746。

command config、production与test合计新增308行代码，低于本change的400行budget；没有新增文件超过400行，整个项目file-size扫描为326个project-authored code source、零例外、零违规。

## 自审发现与修复

完整`just check`首次发现Svelte没有为高阶prop callback提供contextual typing，7个Message mutation参数成为implicit `any`；已逐项补`MessageSpec`并重跑至0 error、0 warning。

focused structure test首次发现旧session顺序oracle仍要求直接赋值`baseDefinition`，以及workbench fingerprint仍冻结旧component-port文本。实现语义没有回退；oracle改为精确要求`replaceBaseDefinition(...)`与新的per-component digest，DOM entry数量保持不变。没有删除、放宽或跳过测试。

外部审阅随后发现For(text-list)仍以`node.id + structure version + itemIndex`生成子编辑器key，导致父ID rename重建全部item row。该P2成立；已删除整个派生key链并改用item object。新增E2E在父Node逐字符rename前记录card/input/textarea对象，之后逐一核对identity和值；源码断言同时禁止该helper/version registry回归。首次E2E因新For body为空而按既有validation拒绝Save，测试为For加入合法Wait body后保留原有显式Save/dirty-revert验证，并非放宽validation。

代码审查确认：

* Visual热路径不存在`cloneJsonValue(draft)`、`draft = next`、每次`JSON.stringify(baseDefinition)`或message JSON clone残留。
* record install、Cancel、Start snapshot等真正需要隔离的clone继续保留。
* clear/New/Delete/persist/published-Create的base切换都同步更新fingerprint。
* editable persisted ID不写入额外schema字段、DOM attribute或storage，也不再参与For子编辑器key；现有duplicate拒绝和collapse reconciliation保持。

## 验证

| Gate | 结果 |
| --- | --- |
| `just test-20260724c` | 24 focused unit/structure与1 Chromium通过 |
| `just check` | file-size/style/TypeScript/Svelte通过，0 error、0 warning |
| `just build` | production build通过 |
| `just test-unit` | 6 theme、239 unit、50 integration通过 |
| `just test-e2e` | 单worker Chromium 58/58通过，约4.8分钟 |
| `git diff --check` / `just diff-check` | 通过 |
| `jj status` / conflict audit | 目标change正确，`conflict=false` |

## 残余边界

为保留“改回base立即恢复clean”，每次accepted mutation仍对当前draft建立一次JSON比较投影；不再重复处理immutable base，也没有clone/replace整棵对象图。超大Macro的增量validation或path-aware dirty算法、JSON editor和terminal输入性能属于明确范围外，不阻断本任务。
