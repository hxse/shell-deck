# Problem Context

## 当前foundation

基线`src/main.ts`只import `src/styles.css`后mount Svelte；`vite.config.ts`没有CSS framework plugin，`package.json`没有Tailwind/daisyUI dependency。所有UI theme值来自project-authored CSS和`TerminalSlot`内的xterm option，不存在统一theme catalog或document-level selection。

`src/lib/browserSettings.ts`当前使用`BROWSER_SETTINGS_KEY = shell-deck:settings:v2`和`schemaVersion: 2`，以exact keys持久化panel、Macro insertion、terminal drag、notification volume和Library preference。`src/App.svelte`在module初始化时load，在`$effect`中save，并在Room topbar的现有Settings popover呈现controls。该owner是Theme preference的正确落点，无需新增store、server state或独立storage key。

## 本阶段要解决的问题

后续surface迁移需要先有稳定的semantic token和theme lifecycle。如果直接在每个component边迁移边自行读取Theme，会形成多个storage owner、多个media listener和不一致的effective theme。反过来，如果本阶段顺手重做全部App视觉，又会让foundation change无法独立审阅。

因此`.001`只建立一条端到端最小链：catalog → exact browser setting → synchronous head bootstrap与pre-mount复核 → Settings control → focused tests。旧CSS继续覆盖尚未迁移的presentation属于明确的暂态，不代表要保留legacy compatibility。

## UI结构选择

App已有Settings button、dismiss layer、popover header和control stack。Theme selector直接追加到这个control stack，不增加popover层级之外的surface。Home在选择前使用`system`默认；用户进入Room选定Theme后，document/browser preference自然也在返回Home时生效。不给Home增加Settings，避免第二个结构例外。

## Schema选择

Theme是current settings schema的新required field，因此直接发布v3 key/schema。项目不读取`v2`key，也不把v2 value转换为v3；v3 key缺失时使用包含`theme: system`的新default。若v3 key存在但shape、extra key或Theme值非法，则沿用current reset notice contract。

## 闪烁与system问题

Theme即使在Svelte `mount`前应用，只要仍依赖application module，就可能在慢速加载时让stylesheet先按default/system完成首帧。foundation必须在head中、任何stylesheet与application module之前通过parser-blocking同步bootstrap设置document；bootstrap由canonical catalog与同一exact settings validator生成，不手写第二份35项列表。`main.ts`仍在mount前重读并复核current settings，负责把runtime状态接回正式owner。`system`不能只在初始时采样OS；它要监听`prefers-color-scheme`，但显式theme时不应继续引发effective theme变化，owner销毁时也不能残留listener。
