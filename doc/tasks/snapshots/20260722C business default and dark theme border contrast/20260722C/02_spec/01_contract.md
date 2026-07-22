# Formal Contract

## 任务边界

本任务交付两个结果：新browser settings默认Theme为`business`；全部canonical暗色theme中的关键边界清晰可辨。它只改变browser-local presentation默认值与theme token，不改变settings key、`schemaVersion: 3`、35个explicit theme、唯一Settings入口、DOM结构、responsive geometry或产品行为。

停止线是默认值、dark token、system dark、代表性control消费、自动化contrast oracle与current docs全部闭合。Light theme重新配色、theme preview、用户自定义palette、像素级截图冻结及视觉风格重做不进入本任务。未达到3:1的canonical dark case、first paint仍不是`business`、覆盖已有有效选择、catalog/scanner漂移或full current regression均阻断Close Gate；纯审美上的进一步加亮不阻断。

## 任务规范

### 默认Theme

`DEFAULT_BROWSER_SETTINGS.theme`唯一默认值为`business`。localStorage不存在current key时直接使用该默认；current v3 value任一字段无效时仍按existing exact-schema contract整体reset，但reset结果改为`business`。已有合法v3 setting必须逐值保留，包括`system`和其余34个explicit theme；v2及更早key继续不读、不删、不迁移。

parser-blocking head bootstrap必须继续序列化同一个default object与exact validator，因此在stylesheet和application module前应用`business`。`main.ts`仍在Svelte mount前复核。CSS registration继续保留`light --default`与`dark --prefersdark`，因为它们负责`system`无`data-theme`时的OS light/dark，不得把daisyUI CSS default错误改成`business`。

### 暗色边界Theme contract

canonical dark theme id由TypeScript唯一常量导出，精确为：`dark`、`synthwave`、`halloween`、`forest`、`aqua`、`black`、`luxury`、`dracula`、`business`、`night`、`coffee`、`dim`、`sunset`、`abyss`。effective color-scheme判断与CSS override scanner都消费该常量，不维护第二份手写集合。

`src/app.css`以一个`:where(...)` theme-token owner精确列出上述14个`[data-theme="..."]` selector，并且只覆盖以下presentation token：

```css
--color-base-300: color-mix(in oklab, var(--color-base-content) 60%, var(--color-base-100));
--depth: 1;
```

另一个且仅一个`@media (prefers-color-scheme: dark)` owner必须包含`:root:not([data-theme])`并覆盖同样两个token，使选择`system`且OS为dark时得到相同结果。main daisyUI registration中的`dark --prefersdark`继续拥有built-in system dark palette；本任务的media owner只提高边界token。Light theme与system light不应用这些override。

应用内普通边界继续使用`border-base-300`，不得为Macro、Library、Settings或terminal单独写fixed color、custom selector或第二套CSS变量。现有daisyUI control若只依赖较弱的implicit border，可在原element上显式加入`border-base-300`。大面积surface不得继续使用增强后的`bg-base-300`；当前terminal host改用`bg-base-200`。

在每个explicit dark theme及`system` dark下，浏览器实际渲染的关键`base-300`边界相对相邻`base-100`surface的WCAG contrast ratio必须`>= 3.0`。计算必须基于computed RGB/RGBA并正确合成透明度，不能只解析source token或用手写期望值冒充browser结果。

### Frozen semantics

Theme selector位置、option catalog、有效设置持久化、observer本地可改、无transport、OS跟随、xterm原位换肤与全部业务语义保持。只允许class presentation变化，不增加element、attribute、test hook、control或wrapper；父基线structure fingerprint仍应保持唯一Theme field四element delta。

## 示例

首次访问且没有current setting：

```text
localStorage["shell-deck:settings:v3"] = missing
first paint: <html data-theme="business" data-theme-color-scheme="dark">
Settings → Theme: Business
```

已有合法`system`setting：

```text
saved theme = "system"
result: data-theme absent; OS light/dark remains authoritative
```

已有非法current value：

```text
saved theme = "business-dark"
result: the exact v3 object resets; Theme becomes "business" and existing reset notice remains
```

## 测试

Unit/guard必须证明default精确为`business`、14个dark id无重复且与effective scheme一致、CSS explicit-dark selector精确消费catalog、system owner精确嵌套在dark media内、两个owner只有允许token且不存在fixed color。负例要证明缺少theme、额外theme、错误mix、错误depth、重复owner或system owner移出media都会被默认`just check`中的residue Gate拒绝。

Browser测试必须延迟application module，证明missing settings的first paint已经是`business`；同时证明已有`system`不被覆盖。contrast matrix遍历14个explicit dark theme与`system` dark，至少测量Settings select、Library control、Macro control和结构panel的实际border/surface颜色并断言`>= 3.0`，同时确认light/system light不被dark override污染。

正式验证顺序为`just check`、`just build`、`just test-20260722c`、`just test-unit`、`just test-e2e`、`just diff-check`。任何warning/error、focused failure、full regression或current doc drift都阻断干净完成结论。
