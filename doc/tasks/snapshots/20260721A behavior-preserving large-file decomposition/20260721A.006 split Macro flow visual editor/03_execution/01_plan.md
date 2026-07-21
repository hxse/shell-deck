# Execution Plan

## 阶段一：UI inventory

记录每种node/branch/lane的DOM、按钮、fields、default JSON、scope inputs和CSS依赖。补齐每个可见按钮与selector的current journey。

## 阶段二：pure logic

先抽defaults与artifact choices，使用现有unit结果证明exact等价；不同时修改组件结构。

## 阶段三：组件拆分

1. 抽Capture/Extract field groups和insertion palette。
2. 抽Action editor，再抽control editor。
3. 最后让MacroFlowNodeList承担递归composition，并收口Parallel lane调用。
4. 每步删除旧branch并运行DOM/button inventory。

## 阶段四：收口

扫描duplicate switch、绕过mutation guard、wrapper/layout drift与choice scope差异。运行完整纯UI dogfood和Gate，review必须列出所有刻意保留的DOM边界。
