# 执行计划

## 阶段一：文档与基线

1. 以`20260726A`源码、active access spec、Quickstart与tests为基线。
2. 冻结raw token QR、上传图片、实时camera、本地解析、性能边界、两个精确public login assets和范围外项。
3. 记录当前关键文件行数；本任务不以压行数为由扩大重构范围。

## 阶段二：共享token与terminal presentation

1. 增加小型共享token格式模块，让server token生成和browser扫描复用同一真值。
2. 安装精确版本`qr` runtime dependency。
3. 增加terminal presentation helper并接入authenticated CLI；programmatic启动与Guest保持无stdout变化。

## 阶段三：browser entry与asset交付

1. 增加纯browser login entry，负责独立file picker与camera入口、资源限制、decode、校验、status和提交。
2. 增加小型camera coordinator，负责Secure Context检查、后置camera请求、单任务自适应scan loop、generation race与track cleanup；共享decoder继续是唯一payload validator。
3. 更新login HTML；移除`capture`混合入口，加入DaisyUI `business` card/input/buttons/alert/modal与responsive layout，不建立第二份CSS truth。
4. 配置Vite production fixed script entry以及dev同路径rewrite；固定stylesheet route复用唯一compiled app CSS。
5. 让Bun admission/page route只公开精确login script与stylesheet；不放宽其他asset。

## 阶段四：测试与current docs

1. 增加token/terminal、live frame sizing与调度work-count unit test，扩展access integration test。
2. 增加真实QR image upload与fake camera stream browser E2E，并提供`just test-20260727a`。
3. 同步active access spec、Quickstart、task index与review。

## 阶段五：串行Gate与审查

按`just file-size`、`just check`、`just build`、focused tests、完整unit、integration、E2E、`just diff-check`顺序执行。任何warning/error均修复；最后核对`jj diff`、行数、依赖锁文件、public asset allowlist和task truth chain。

## Legacy Kill List

本任务不退出手工token或图片fallback。需要清理的旧口径包括“`GET /login`无任何external asset”、“所有未登录asset一律401”以及用单个`capture="environment"`按钮混合相机与选图；最终只能保留精确login script/stylesheet例外，不得留下旧`Scan QR`/`capture`入口、临时CDN、inline decoder、第二CSS source、第二token schema或宽泛`/login-assets/**`白名单。
