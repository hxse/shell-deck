# Contract

## 任务边界

本任务只修改browser terminal view lifecycle。server仍是terminal output、Text正文、revision和runtime状态的唯一真值；active terminal selection仍是browser-local，tab切换不产生Room mutation。

`.030`的bounded replay/parser pump和`.032`的historical hydration stdin guard继续有效。修复不能通过丢弃replay、停止hidden terminal output或把所有terminal历史同时预解析来掩盖问题。

## 任务规范

### Lazy retained view

* 页面初次进入Room时，只mount当前active terminal；未访问terminal不创建xterm/Text editor，也不解析其replay。
* terminal第一次成为active时创建对应view，并执行一次当前server replay hydration。
* 已访问terminal切为inactive时，保留同一Svelte component、DOM和xterm/Text local state，只把pane从布局和交互中隐藏。
* 再次active必须复用同一view；不得dispose/recreate xterm，不得重新enqueue完整replay，不得重置Text editor本地状态。
* terminal从Room collection删除、Room workspace unmount或页面离开时，正常dispose retained view并释放observer/parser/xterm资源。
* server明确发布replace update、terminal launch变化或reset时，仍按既有真值重建对应xterm；这不是tab切换。

### Hidden Shell行为

* visited但inactive的Shell继续按terminal revision消费live append；重新显示时立刻看到最新状态，不补做全量history replay。
* hidden Shell不得按零尺寸发送PTY resize。变为active后在浏览器完成布局时执行一次必要的host尺寸校准；尺寸未变化时不重复resize。
* live terminal query response属于terminal emulator正常输出处理，即使pane当前隐藏也不能因为tab状态被全局关闭。只有historical replace hydration期间继续使用现有`disableStdin` guard。

### Hidden Text行为

* visited但inactive的Text pane继续接收server text revision并遵守现有single-in-flight/coalescing规则。
* tab切换保留textarea DOM、scroll position、selection和未完成local write state；server truth变化仍可按现有revision contract更新内容。

### 可访问性与布局

* 同一时刻只允许active pane可见、可聚焦和参与布局；inactive retained pane必须带`hidden`语义。
* terminal pane/header/tab现有视觉和canonical label完全不变。

### Full E2E discovery

* `test:e2e`必须通过Playwright默认规则发现`tests/e2e`内全部current `*.spec.ts`，不得用人工文件allowlist把失败或新增journey漏出Gate。
* `.031B`的`.031A`历史journey仍逐字保留为`comprehensiveUiBehavior031B.historical.ts`，但它不是当前产品contract，不能继续使用`.spec.ts`后缀进入current Playwright discovery。
* unit oracle固定历史文件byte digest，并断言不存在同名可发现的`.spec.ts`；修复不得修改历史journey内容来迎合当前UI。
* current comprehensive journeys继续由full E2E执行；`test:031b`仍单独验证historical inventory与attributed current journey。

## 示例

### 长Shell历史切到Text再切回

首次打开Shell时hydration历史一次。点击Text后Shell xterm仍存在但hidden；点击Shell后立即显示原xterm canvas和最新live output，parser enqueue/write计数不因点击增加。

### 合法重建

Shell被Reset或Room reconnect提供同launch的新replace truth时，可以重建xterm并hydration一次。删除Shell再新建同index terminal也是新runtime identity，不复用旧view。

### 非法实现

只删除`{#key}`但仍用单一`{#if activeTerminal}`渲染不成立：切换分支仍会unmount。把所有Room terminals在首次连接时全部mount也不成立：它会回退大历史首次加载性能。

## 测试

### Browser E2E

* 构造离线Fake Shell长replay和Text terminal；未访问Text view初始不存在。
* 首次打开Text后，Shell host仍在DOM但不可见；往hidden Shell发送live output可推进原host revision。
* Shell/Text往返至少三次，host DOM probe保持不变，render revision、enqueue、parser consumed和write计数不因纯切换增加。
* terminal删除后对应retained pane消失并释放。
* 带DA、cursor position、OSC 10/11 query的历史在真正page reload hydration时仍产生零`terminal_input`；之后tab切换同样零输入且不再hydration。
* Text长内容的scroll position在Shell/Text往返后保持。

### Gate

依次运行`just check`、`just build`、focused `roomLargeReplay032`、目录级full E2E、`just test-039`、`just test-031b`与`just diff-check`。全部自动化离线运行，不启动真实Codex。
