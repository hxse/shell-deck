# Problem Context

## 为什么最后才加Gate

当前父版本本来就有多份超过400行的目标文件。如果root阶段立即接入默认Gate，`.001-.013`的每个中间change都会被已知后续文件阻断，迫使临时allowlist不断变化。正确顺序是先依次完成所有拆分，再由`.014`一次建立零临时豁免的最终规则。

## 扫描范围

scanner从repo root递归分类project-authored code，而不是只固定四个TypeScript目录。发现范围至少包含root config/entry、JS/TS variants、Svelte、CSS/HTML、native C/C++、shell/Nix及其他显式source extension；`justfile`、`package.json`和`tsconfig.json`等exact config同样受控。这样未来的`.js/.tsx/.mjs`、root config、`src/app.css`或`server/ptyHelper.c`不能绕过。

VCS metadata、third-party dependency、runtime cache与build/test output不是project-authored source，使用明确directory classification跳过。docs与数据文件不因行数被误当成code；authored code不能靠业务目录、文件名、fixture、generated或historical标签取得豁免。

## 零例外

`.013`已经删除不参与current discovery的raw historical journey及hash-only oracle；结构化`.031B` control inventory baseline仍保留。scanner不再包含path/digest special case，所有被发现的authored source统一适用400行上限。

## Closeout原则

`.014`不替前序child修代码。若scanner或完整测试发现问题，回到最早引入问题的change修复并让后继自动rebase；冲突时停止/undo，不在closeout change堆兼容或豁免。
