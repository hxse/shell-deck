# Flexible Parallel shared Text routing contract

## 任务边界

本任务把唯一 current Macro schema 破坏性切换为 `MacroDefinitionV6`。Parallel lane 继续是按数组顺序声明、内部顺序执行的线性分支，但 terminal reference 下沉到每个 Action；Parallel 不再要求或产生 text return。

旧 V5 与下列旧 Parallel shape 必须 fail loudly，不迁移、不补默认、不 dual-read：

* lane-level `terminal`；
* final `{type:"output"}`；
* parent `merge`；
* `merged_text` artifact 与对应 source choice；
* 缺少 `sharedTextOrder` 的 Parallel。

任务交付到 V6 schema、validation、visual/JSON authoring、runtime queue、focused/full regression 与 current docs 全部闭合为止。HTTP/Room/Text incremental protocol、terminal input delivery/ending、MacroRecord envelope、controller/content lease、Prepare 和 durable run-event schema不重做。

Parallel 不管理 Text 初始内容。它不 clear、replace、reserve 或锁住用户手工编辑，也不承诺排除 Parallel 之外的其他 Text mutation；顺序保证只覆盖同一次 Parallel invocation 内、由 shared Text Send 产生的 append。

## 任务规范

### V6 Parallel shape

```ts
type ParallelSharedTextOrder = "pane_order" | "completion_order"

type ParallelLaneActionNode =
  | SendNode
  | Extract<WaitNode, { mode: "duration" | "terminal-quiet" }>
  | Exclude<CaptureSourceNode, { capture: { kind: "structured-json" } }>
  | ExtractTextNode
  | NotifyNode

type ParallelLane = {
  id: string
  label: string
  body: ParallelLaneActionNode[]
}

type ParallelNode = {
  id: string
  type: "parallel"
  lanes: ParallelLane[]
  sharedTextOrder: ParallelSharedTextOrder
  onLaneFail: "pause" | "fail"
}
```

`lanes`和`lane id`继续是 persisted schema 名称；UI把一条 lane 呈现为一个 pane。新建 Parallel 默认一条空 `lane_1`，`sharedTextOrder:"pane_order"`，不自动插入 Output 或其他 Action。

Parallel pane 允许 Send、duration/terminal-quiet Wait、terminal-buffer/text-box/agent-event Capture、Extract Text 与 Notify。允许的 Action 使用与 root Flow 相同的 exact shape：Send、terminal-quiet Wait 和 Capture各自保存显式 terminal reference。Input、user-continue Wait、structured-json Capture 和全部 control node 禁止进入 pane，因为它们会引入 run-global pending interaction或动态执行计划。

pane 内 Capture/Extract 产生的 artifact 只对同一 pane 中更晚的 Action 可见；sibling pane 不可见，Parallel 外也不可见。Parallel 自身不产生 artifact。外部 Flow需要聚合结果时，应在所有 pane自然结束后 Capture shared Text。

### Terminal usage policy

每个 Parallel node 都从其 Action 的 assigned terminal reference 和 definition `terminalLayout` 推导 usage；`unassigned`继续由 runnable validation处理，不猜测 terminal。

* 同一个 Shell index 可被同一 pane 的多个 Action 使用，但不能被两个不同 pane 引用。UI显示`Shell · owned by lane_1`并在其他 pane selector中禁用该Shell；JSON仍由validator兜底拒绝冲突。
* 一个 Text index只被一个 pane引用时是`Exclusive Text`。该 pane可以立即 Send或使用允许的Capture读取它。
* 一个 Text index被两个或更多 pane引用时是shared Text。shared Text在Parallel内只允许作为Send target；Capture、terminal-quiet Wait或其他读取/非append使用均非法。
* shared/exclusive由当前definition自动推导，不保存第二个mode字段。多个shared Text各自拥有独立queue。

pure usage policy是validator、selector disabling、状态badge、help text和runtime plan的唯一规则源。UI不得另写一套近似判断。

Visual editor必须按当前reactive draft revision只构造一次derived usage index。Terminal usage badge按action id读取该index；selector availability按terminal index读取同一index，不能为每个Action或每个terminal candidate重新遍历整个Parallel。

状态文案固定为：

* `Exclusive Text`
* `Shared Text · pane order`
* `Shared Text · completion order`
* `Shell · owned by <laneId>`

状态旁的theme-native help必须支持hover、keyboard focus与tap，并解释Shell不可跨pane共享、shared Text只允许Send append，以及两种order只决定shared Text Send顺序。

### Shared Text实时队列

Start冻结definition后，为每个shared Text建立静态 Send plan。pane-order plan按`lanes`数组顺序展开，再按每条`body`数组顺序收集指向该Text的Send action id。这个plan只在本次 Parallel invocation内有效；同一Parallel位于For中时，每次invocation创建独立queue。

`completion_order`采用per-target FIFO。Send完成message/template/artifact evaluation后，把最终payload交给queue；queue按触发顺序立即调用现有authoritative terminal input/append链路。Send只有在实际append成功后才完成，因此同一pane的后继Action不能越过它。

`pane_order`为每个target保存`cursor + ready payloads + waiters`：

1. Send触发后按其静态ordinal放入ready map。
2. ordinal不等于cursor时保持等待，不写Text。
3. cursor对应payload到达后立即append。
4. append成功才完成该Send、推进cursor，并连续drain已经ready的后继ordinal。
5. append失败不推进cursor；该Action按正常lane failure语义处理，Resume重试时重新提交。

算法不会等待全部pane结束才flush。已经符合顺序的payload实时可见；未轮到的payload只保存在本次run的memory-only queue，不写artifact或durable event。一次payload由单次terminal mutation提交，pane之间不会把同一payload拆成字节级交错。

同一次Parallel invocation的write ledger必须覆盖全部Send，而不只shared Text。每个Send分别记录`written`与`recorded`：terminal mutation成功后即冻结`written`；若随后`terminal_input_sent` durable event失败，Pause/Resume重试只补`recorded`，不得再次写Shell或exclusive/shared Text。write失败则保持可重试且不得伪记event。

### Pause、Fail、Stop与自然结束

Parallel仍以“全部pane结束后执行外部下一个node”为自然join，不增加Join schema或UI。

`onLaneFail:"pause"`时，任一pane失败必须立即请求run Pause，而不是等待所有pane settle。失败Action保留当前progress；shared Text已完成append不回滚，尚未轮到的waiter保留。Resume重试失败Action；它若补上队列缺失的前序Send，queue随即按规则drain。

每次Parallel invocation必须拥有一个只服务于本次调用的cancellation scope，并把它传入每个pane Action及shared Text queue。`onLaneFail:"fail"`、Action触发`finish`、Stop、Room Destroy或run abort必须abort sibling Action和未完成queue waiter，使unbounded Capture、Wait或Notify不会阻止Parallel terminalize；`onLaneFail:"pause"`不得abort该scope，既有sibling与queue waiter原地保留，Resume只重试失败pane。已经append的partial Text保留；尚未append的payload不得补写。terminal mutation、event append或queue callback失败继续走既有错误体系，不能伪报step completed。

### UI与authoring

Parallel header保留Node id、pane tabs、Add/Remove pane与On lane fail，并新增一个`Shared Text order`控件，默认Pane order，可切换Completion order。该控件只影响shared Text，不能改变exclusive Text、Shell、pane内部Action顺序或Parallel外部Flow。

删除Lane tab selector、Lane result、Collect lane text、final Output editor和Merge controls。每个terminal-bearing Action在自己的card内显示Target/Source tab selector及usage状态。palette允许新增Notify；不显示Input、user-continue、structured-json或control node。

Visual mutation继续通过唯一Macro draft gateway；usage policy不缓存draft、不创建第二份rune state。JSON editor只接受V6 exact shape，不自动转换V5。

## 示例

以下Macro让两个pane分别操作Shell 1/2，并把capture实时append到同一个Text 3。默认pane order保证`lane_1_to_text`先于`lane_2_to_text`写入；Parallel结束后，root Capture读取Text 3的当前完整内容。

```json
{
  "schemaVersion": 6,
  "name": "parallel review into text",
  "description": "Two shells append captured results into one Text tab.",
  "terminalLayout": [
    { "index": 1, "type": "shell" },
    { "index": 2, "type": "shell" },
    { "index": 3, "type": "text" }
  ],
  "body": [
    {
      "id": "review_parallel",
      "type": "parallel",
      "sharedTextOrder": "pane_order",
      "onLaneFail": "pause",
      "lanes": [
        {
          "id": "lane_1",
          "label": "Reviewer A",
          "body": [
            {
              "id": "lane_1_send",
              "type": "send",
              "terminal": { "kind": "terminal_index", "index": 1 },
              "message": { "parts": [{ "kind": "text", "text": "Review A" }] },
              "delivery": "auto",
              "ending": "cr"
            },
            {
              "id": "lane_1_capture",
              "type": "capture-source",
              "capture": {
                "kind": "terminal-buffer",
                "terminal": { "kind": "terminal_index", "index": 1 },
                "mode": "scrollback-tail",
                "maxChars": 20000
              }
            },
            {
              "id": "lane_1_to_text",
              "type": "send",
              "terminal": { "kind": "terminal_index", "index": 3 },
              "message": {
                "parts": [
                  {
                    "kind": "artifact",
                    "source": {
                      "kind": "step_artifact",
                      "stepId": "lane_1_capture",
                      "artifact": "captured_text"
                    }
                  }
                ]
              },
              "delivery": "auto",
              "ending": "none"
            }
          ]
        },
        {
          "id": "lane_2",
          "label": "Reviewer B",
          "body": [
            {
              "id": "lane_2_send",
              "type": "send",
              "terminal": { "kind": "terminal_index", "index": 2 },
              "message": { "parts": [{ "kind": "text", "text": "Review B" }] },
              "delivery": "auto",
              "ending": "cr"
            },
            {
              "id": "lane_2_capture",
              "type": "capture-source",
              "capture": {
                "kind": "terminal-buffer",
                "terminal": { "kind": "terminal_index", "index": 2 },
                "mode": "scrollback-tail",
                "maxChars": 20000
              }
            },
            {
              "id": "lane_2_to_text",
              "type": "send",
              "terminal": { "kind": "terminal_index", "index": 3 },
              "message": {
                "parts": [
                  {
                    "kind": "artifact",
                    "source": {
                      "kind": "step_artifact",
                      "stepId": "lane_2_capture",
                      "artifact": "captured_text"
                    }
                  }
                ]
              },
              "delivery": "auto",
              "ending": "none"
            }
          ]
        }
      ]
    },
    {
      "id": "capture_aggregate",
      "type": "capture-source",
      "capture": {
        "kind": "text-box",
        "terminal": { "kind": "terminal_index", "index": 3 }
      }
    }
  ]
}
```

如果把`sharedTextOrder`改成`"completion_order"`，先触发的`lane_2_to_text`可以先写；同一pane内仍不可能越过自己的前序Action。

以下配置非法：两个pane引用同一个Shell，或shared Text同时被任一pane Capture。

```json
{
  "id": "invalid_parallel",
  "type": "parallel",
  "sharedTextOrder": "pane_order",
  "onLaneFail": "fail",
  "lanes": [
    {
      "id": "lane_1",
      "label": "A",
      "body": [
        {
          "id": "a",
          "type": "send",
          "terminal": { "kind": "terminal_index", "index": 1 },
          "message": { "parts": [] },
          "delivery": "auto",
          "ending": "cr"
        }
      ]
    },
    {
      "id": "lane_2",
      "label": "B",
      "body": [
        {
          "id": "b",
          "type": "send",
          "terminal": { "kind": "terminal_index", "index": 1 },
          "message": { "parts": [] },
          "delivery": "auto",
          "ending": "cr"
        }
      ]
    }
  ]
}
```

Text 3在run前已经有内容时，新payload直接append到现有内容。产品不会隐式clear；这不是validation error，也不会改变order算法。

## 测试

Document Gate必须证明V6 public shape、主目标场景、共享规则、实时算法、Pause/Fail/Stop语义和Legacy Kill List明确。Code/Test Gate至少覆盖：

* exact V6 parse/round-trip与V5、lane terminal、Output、merge、`merged_text`、缺少order失败；
* pure usage policy对exclusive Text、两种shared Text、Shell owner、shared read conflict、unassigned和multiple targets的分类；
* pane-order中later-first等待、前序到达后连续drain、同pane顺序、multiple target独立queue；
* completion-order按实际触发立即append；
* append失败不推进cursor，Pause/Resume可补齐，Fail/Stop取消waiter且partial Text保留；
* runner使用真实Text terminal证明实时append、外部Capture读取结果，并证明Shell跨pane拒绝；
* visual editor删除旧Output/Merge/Lane terminal，Action显示显式terminal selector与四类状态，Shell在其他pane禁用，Text可共享，help可hover/focus/tap；
* current Macro comprehensive journey、structured JSON forwarding、Prepare/layout、runner snapshot/Trace、theme/structure oracle没有无关回归。

focused入口为`just test-20260729a`。Close Gate串行执行`just check`、`just build`、`just test-unit`、`just test-integration`、`just test-20260729a`、`just test-e2e`与`just diff-check`；任何warning/error、P1/P2、旧正式写法残留或超过400行的project-authored code都阻断完成。
