# Explicit Macro Insertion Icon Contract

## 任务边界

本任务只改变 Macro structural insertion control 的 glyph 和用户可见名称。按钮数量、固定顺序、24px button、15px SVG、DaisyUI button theme、disabled state、click target、insertion anchor、palette lifecycle、focus restore、Escape、DOM control order和既有test id保持。

不改变 MacroDefinitionV5、draft mutation、validation、Save/Prepare/Start、Parallel Output例外、Text terminal协议或其他图标语义。不得增加第三方icon library、兼容旧glyph的分支或专用CSS。

## 任务规范

Macro结构操作使用唯一视觉语法：

* 单独的向上箭头：移动当前项向上；
* 单独的向下箭头：移动当前项向下；
* 同一glyph中的加号和向上箭头：在当前项之前插入；
* 同一glyph中的加号和向下箭头：在当前项之后插入。

插入方向统一使用`before` / `after`术语。通用按钮的`title`与`aria-label`分别为`Insert before`和`Insert after`；For text-list使用`Insert item before`和`Insert item after`。图形使用SVG `currentColor`并继续由主题按钮状态提供颜色。

`MacroIconButton`是Collapse、Move、Insert和Remove glyph的唯一组件真值。`NodeActionControls`必须通过它渲染全部六个按钮，不得保留本地before/after SVG。该规则覆盖普通与嵌套Flow node、Parallel lane action和For text-list item。

旧`insert-above` / `insert-below` icon kind及旧“横线 + 加号”插入图形退出current source；不保留alias。

## 示例

对垂直列表中的当前项`B`：

```text
+↑  => [new, B]
+↓  => [B, new]
 ↑  => 把 B 与前一项交换
 ↓  => 把 B 与后一项交换
```

点击普通Flow node的`Insert before`仍打开绑定该node之前anchor的既有palette；点击For item的`Insert item after`仍在`index + 1`创建exact empty item。

## 测试

Focused tests必须证明：

1. shared component只暴露current `insert-before` / `insert-after` kind，且glyph分别为`+↑` / `+↓`；
2. `NodeActionControls`不再包含本地SVG，并继续以原顺序输出六个共享按钮；
3. Flow与Parallel before/after按钮保留test id、accessible name和真实插入位置；
4. For text-list before/after按钮保留test id，并分别在当前index与`index + 1`插入；
5. `just check`、focused Chromium E2E、file-size和diff-check通过且无warning。
