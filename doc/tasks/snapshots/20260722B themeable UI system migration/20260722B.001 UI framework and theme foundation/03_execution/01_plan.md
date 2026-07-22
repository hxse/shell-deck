# Execution Plan

## 1. 先冻结foundation tests

* 更新browser settings test为v3 exact contract，并增加v2 key non-read、invalid Theme和all-catalog coverage。
* 增加theme catalog/config一致性与document application unit test。
* 扩展current Settings E2E/inventory，先明确唯一允许的新增control。

## 2. 接入framework

* 通过项目package manager安装并lock Tailwind CSS 4、official Vite plugin和daisyUI 5。
* 添加最小framework CSS entry与Vite plugin，注册root spec列出的全部内置theme。
* 保留existing route bridge、Svelte plugin和legacy entry，运行build确认generated CSS与current页面同时可用。

## 3. 建立Theme lifecycle

* 实现单一catalog/guard/application module，并让exact settings validator可被build-time bootstrap generator安全复用。
* 将browser settings hard cut到v3；在head中生成stylesheet前同步bootstrap，并由main在mount前复核initial Theme。
* 在App settings state变化时更新document，正确管理`system` media listener cleanup。

## 4. 加入唯一UI结构变化

* 在Settings header之后添加compact labelled select，options直接消费canonical catalog。
* 验证controller和observer都只改变browser-local preference，Settings其余交互不变。

## 5. 自审与收口

* 对照DOM inventory确认除Theme label/select外无结构diff。
* 扫描重复catalog、第二storage key、v2 reader、Room transport引用和动态Tailwind class。
* 执行focused unit/browser（含延迟entry module的首帧computed-style oracle）、`just check`、`just build`和`git diff --check`，按P1/P2/P3记录结果。
