# Problem Context

## 为什么需要独立closeout

分阶段迁移允许`.001`至`.003`短暂保留仍有live consumer的旧style owner。这种策略降低单change风险，但也容易留下“看起来已经迁移”的死file、unused import、component `<style>`、固定light color或旧test oracle。没有独立、机器可重复的最终Gate，就无法证明用户要求的全面清理真正发生。

## “旧CSS一行不留”的可执行定义

本项目终态不是完全没有CSS：Tailwind和daisyUI仍需要一个source entry，xterm仍加载package-owned vendor stylesheet。用户要求被定义为迁移前project-authored implementation零残留：

* `src/styles.css`和`src/styles/**`不存在。
* `src/**/*.svelte`不存在project-authored `<style>` block。
* 不存在把旧selector/declaration复制到`app.css`、另一个CSS file、`@apply`component layer或generated source的替身。
* production markup使用framework class与semantic token；旧semantic class可以在确有behavior/test hook时保留为attribute，但不得再有custom CSS rule owner。
* xterm vendor CSS仍由`@xterm/xterm/css/xterm.css`提供；它不属于repo-authored legacy source。

## 唯一source entry

最终`src`内只有`src/app.css`一个project-authored `.css`文件。它只承载Tailwind import、daisyUI theme registration、non-color font token和xterm generated-DOM所需的最小structural bridge。所有可以写在existing markup上的layout/state presentation必须留在static utility class中，不能回流成新的global stylesheet。

## 全theme风险

只在light/dark截图通过不能证明35个内置theme可用。不同theme的base/content/neutral/accent对比和`color-scheme`可能改变native form/xterm appearance；wireframe、black、cyberpunk等极端theme尤其容易暴露固定light background或弱border。Closeout需要遍历catalog而不是只抽样，但不必为105+组合维护脆弱的pixel screenshot。

## 测试真值

`.003`已提交从`20260722A.002`父revision生成的稳定per-file structure fixture，并用geometry/state oracle替换旧Macro cascade hash；`.004`逐文件消费该fixture、冻结Theme四element唯一delta，再增加全项目source manifest、Theme catalog/config一致性和全theme/viewport matrix。历史`.009`文档与测试结论保留在snapshot中，不回写历史来声称原CSS从未存在。

## Active spec收口

Theme preference将使browser settings从v2变为v3，并新增全局presentation truth。完成后应建立`ui_theme_contract.md`，同时更新active spec readme、user data storage、architecture、room terminal、Macro和Library中与browser-local Theme、xterm bridge或保留结构直接相关的段落；不把未落地设计写成current truth。
