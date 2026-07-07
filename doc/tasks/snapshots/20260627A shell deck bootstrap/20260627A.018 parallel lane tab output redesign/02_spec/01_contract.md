# Contract

## Scope

范围内：

* 用新的 `parallel` action 替换 `parallel_send_capture`。
* `parallel` UI 使用 lane tabs，每个 lane 显示自己的 action list。
* Lane 内只允许：
  * `send_line`
  * `wait`
  * `capture-source`
  * `extract_text`
  * 固定末尾 `output`
* `output` 是 lane 固定节点，不是 root action，不出现在 floating palette。
* `output` 必须存在，必须是每个 lane 的最后一个节点，不可删除，不可移动，不允许在其后插入 action。
* `output` 可以选择：
  * `none`
  * 本 lane 内前序 `capture-source.captured_text`
  * 本 lane 内前序 `extract_text.extracted_text`
* `parallel` 结束时按 lane 顺序合并每个 lane 的 output，生成 `merged_text` artifact。
* 下游 `send_line` / `input_line.defaultSource` / `extract_text` / `if.text_match` 可以引用 `parallel_id.merged_text`。
* `parallel_send_capture` 进入 removed legacy type，新模板不再支持。

范围外：

* 不恢复 `parallel_all`、`merge_parallel_results`、`send_artifact`。
* Lane 内不允许 `input_line`、`if`、`for`、`break`、`continue`、`finish` 或 nested `parallel`。
* Lane 内不允许 `wait.user-continue`。
* 不做旧 `parallel_send_capture` 自动迁移。
* 不做 lane drag-and-drop；V0 只需要 Add/Remove lane 和基本 tab 切换。

## JSON Schema

`parallel` node:

```json
{
  "id": "parallel_review",
  "type": "parallel",
  "lanes": [
    {
      "id": "docs",
      "label": "Docs",
      "terminal": { "kind": "alias", "value": "docs" },
      "body": [
        {
          "id": "send_docs",
          "type": "send_line",
          "terminal": { "kind": "alias", "value": "docs" },
          "message": { "parts": [{ "kind": "text", "text": "review docs" }] }
        },
        {
          "id": "wait_docs",
          "type": "wait",
          "mode": "terminal-quiet",
          "terminal": { "kind": "alias", "value": "docs" },
          "quietMs": 1000,
          "maxMs": 120000,
          "onTimeout": "pause"
        },
        {
          "id": "capture_docs",
          "type": "capture-source",
          "capture": {
            "kind": "terminal-buffer",
            "terminal": { "kind": "alias", "value": "docs" },
            "mode": "scrollback-tail",
            "maxChars": 12000
          }
        },
        {
          "id": "output_docs",
          "type": "output",
          "source": {
            "kind": "step_artifact",
            "stepId": "capture_docs",
            "artifact": "captured_text"
          }
        }
      ]
    }
  ],
  "merge": {
    "kind": "sectioned_text",
    "separator": "\n\n===== {laneId} | {laneLabel} | {terminalAlias} =====\n\n",
    "includeEmptyOutputs": false
  },
  "onLaneFail": "pause"
}
```

`output` with no contribution:

```json
{
  "id": "output_docs",
  "type": "output",
  "source": { "kind": "none" }
}
```

## Lane Rules

Each lane:

* must have an `id` unique within the parent `parallel`;
* may have a `label`, and non-empty labels must be unique within the parent `parallel`;
* all lane action/output node ids still obey the template-wide Flow V2 node id uniqueness rule;
* must choose one terminal that is unique within the parent `parallel` node;
* must have `body.length >= 1`;
* must end with exactly one `output` node;
* must not contain `output` anywhere except the last item;
* must not contain more than one `output`;
* must not allow `Remove`, `Move up`, `Move down`, `Add after`, or `Move existing after` on `output`;
* must only allow inserting `send_line` / `wait` / `capture-source` / `extract_text` before `output`.

Lane action terminal consistency:

* `send_line.terminal` must resolve to the lane terminal.
* `wait.terminal-quiet.terminal` must resolve to the lane terminal.
* `capture-source.capture.terminal` must resolve to the lane terminal.
* `extract_text` has no terminal and can read only visible predecessor artifacts in the same lane.

Lane `wait` and `extract_text`:

* `extract_text.onEmpty` only allows `pause` or `fail`; `continue` and `finish` are control-flow outcomes and are not valid inside parallel lanes.

* `duration` is allowed.
* `terminal-quiet` is allowed and `onTimeout` must be `pause`.
* `user-continue` is not allowed inside `parallel` lanes.

## Output Rules

`Output` is mandatory because the lane must state what, if anything, it contributes to the merge.

It is fixed as the final lane node for three reasons:

* UI always has a clear bottom summary for each lane.
* Validator can prove merge input without guessing the last producing action.
* Users cannot accidentally add more work after a lane has declared its output.

`Output.source` rules:

* `{ "kind": "none" }` means this lane contributes no text.
* `step_artifact` must reference a visible predecessor in the same lane.
* Valid artifacts are `captured_text` and `extracted_text`.
* It cannot reference another lane.
* It cannot reference the parent `parallel` node.
* It cannot reference a later action.

## Merge Rules

`parallel` waits for every lane to complete. If all lanes complete:

1. It reads each lane `Output`.
2. It skips empty/none output when `includeEmptyOutputs = false`.
3. It renders `separator` before each included lane output.
4. It writes one `merged_text` artifact under the `parallel` node id.

Supported separator variables:

* `{laneId}`
* `{laneLabel}`
* `{terminalAlias}`

If a lane fails or times out:

* `onLaneFail = pause` pauses the parent run.
* `onLaneFail = fail` fails the parent run.

## UI Contract

Parallel editor:

* Shows lane tabs instead of stacked item cards.
* `Add lane` creates a lane with:
  * unique id;
  * current default terminal;
  * body containing only fixed `Output` with `source = none`.
* Selecting a lane tab shows that lane body.
* Terminal choices already used by another lane in the same parent `parallel` are disabled in the lane terminal selector.
* Parent `onLaneFail` is editable as `pause` or `fail`.
* Lane body uses the same local insertion affordance as Flow V2, but the palette only includes:
  * `send_line`
  * `wait`
  * `capture-source`
  * `extract_text`
* The fixed `Output` card is always visible at the bottom of the lane.
* `Output` card contains only a source selector and a short summary.
* `Output` card has no remove button and no move controls.
* The insertion menu shown before `Output` is the normal way to add lane actions.

## Event Log

New event names:

* `parallel_started`
* `parallel_lane_started`
* `parallel_lane_completed`
* `parallel_joined`

Events remain step-scoped to the parent `parallel` step. Lane-specific events include `laneId` in `data`.

## Validation Gate

Required tests:

* schema accepts a valid `parallel` with lane tabs and fixed output;
* schema rejects missing output;
* schema rejects output not last;
* schema rejects deleting output by importing a lane without it;
* schema rejects action after output;
* schema rejects lane-local `input_line`, nested `parallel`, and flow controls;
* schema rejects `wait.user-continue` inside lane;
* schema rejects output referencing a different lane or future action;
* runner merges each lane output into `merged_text`;
* runner handles `output.none`;
* UI cannot remove/move Output and can add allowed actions before Output.
