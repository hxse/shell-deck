# 20260726A Review and Verification

## 总体判断

显式访问模式与browser鉴权已落地。Just以八个原生recipe alias固定选择`guest|authenticated`和`local|lan`：production为`sgl/sgn/sal/san`，development为`dgl/dgn/dal/dan`；旧`--host`与`SHELL_DECK_ALLOW_LAN`直接退出。Guest与Authenticated通过门后能力相同，LAN可由同一Wi-Fi手机使用computer LAN IP访问，server不检测client IP。

Authenticated每次process生成192-bit随机token，以constant-time digest comparison换process-local HttpOnly session；token不进入URL、cookie或持久化。Host/Origin/session admission位于WebSocket upgrade和全部Room route之前。Local只允许loopback Host；LAN再允许server自身interface/machine hostname，阻断任意hostname的DNS rebinding。Production只接受请求自身Origin，dev只额外接受相同hostname的固定Vite port；AgentEvent/structured JSON只有携带既有ingest header的精确route可以继续进入原Room/launch/token validator。

首次closeout后的安全复审发现Vite page bridge、dev source admission、token可见性、LAN Host、programmatic validation与route classification共六项遗漏；后续复审又发现dev Origin被错误放宽到任意allowlisted hostname、长位置参数入口既冗长又让Just原生arity错误先于帮助出现，以及login page的`no-referrer`让真实Chromium form POST携带`Origin: null`并被自身guard拒绝。最终入口改为concrete recipes + Just官方`alias`，login改用`same-origin` referrer policy。全部在同一change内修复并以真实Vite/Chromium/just回归；最终审阅未发现范围内未解决P1/P2/P3，Formal Document、Code、Test、Current Docs与Close Gate通过。

## Gate 结论

| Gate | 结果 |
| --- | --- |
| `just test-20260726a` | 8个Just alias exact展开/options透传 + 2项help + 3项NixOS firewall helper dry-run + 5项Bun测试通过；覆盖CLI/programmatic入口、login referrer policy、真实Authenticated/Local、session隔离、hook、真实Vite page/source、exact-host dev Origin、LAN Host与DNS rebinding |
| `just check` | 通过；355个project-authored code文件无hard issue，TypeScript通过，Svelte 0 error / 0 warning |
| Production build | 通过；403 modules，6.48秒 |
| Full unit/integration入口 | 6项theme + 268项core + 7项quota + 3项access + 57项integration通过 |
| Full Chromium E2E | 59项通过，单worker，4.7分钟 |
| Project file-size | 355个project-authored code文件全部不超过400行，0 exception |
| Current change TypeScript additions | 399行，不超过400行 |
| Diff check | 通过 |
| jj conflict | `rszusqpp`最终确认为`conflict=false` |

完整unit首次运行只命中current E2E inventory aggregate digest变化；这是Playwright启动命令从旧`--host`切换为明确`guest/local`造成的预期oracle变化。Case、expect、route与wait数量均未变化，更新exact digest后完整入口通过，没有删除或放宽测试。

最终Host allowlist后的一次完整unit重跑中，既有AgentEvent 1000-entry性能case在机器瞬时负载下以7.1秒撞到固定5秒timeout；同一case此前2.3秒通过，随后独立重跑2.49秒、完整入口重跑2.13秒并通过。未修改timeout、测试或相关production代码。

## Findings and Solutions

### 1. P1 / L1：HTTP/WS在Room mutation前缺少统一browser安全门

新增`ServerAccessController`作为Bun fetch的第一道admission。它先验证请求Host属于server自身地址/hostname并拒绝cross-site或错误Origin，再执行Guest/Authenticated gate，最后才允许WebSocket upgrade、Room route和page route。Vite page bridge也转发`Origin`与`Sec-Fetch-*`，只有Bun返回200才渲染；真实Vite回归对cross-site `/`断言403且Room registry保持空。直接Bun回归继续证明cross-site API在mutation前403、未认证WS在upgrade前401。

### 2. P2 / L1：Local/LAN与Guest/Authenticated原来混在host环境开关中

启动contract破坏性切换为两个正交必填mode。Local精确映射`127.0.0.1`，LAN精确映射`0.0.0.0`；四种组合全部合法。Just为每个组合提供冻结mode的concrete recipe，再用官方`alias`暴露`sgl/sgn/sal/san`与`dgl/dgn/dal/dan`；options由variadic parameter原样透传，shell不解析mode。`start/dev`作为help-only recipe直接显示映射且不build。Guest LAN只打印完整能力警告，不增加隐藏开关或交互确认。底层CLI和programmatic `StartOptions`同样独立验证必填/非法mode并返回稳定错误；旧`--host`被exact parser拒绝，旧`SHELL_DECK_ALLOW_LAN`即使为空也以稳定错误退出。

LAN launch保持portable且不隐式提权。NixOS用户可显式运行`fw-open [port]`、`fw-show`与带Just原生confirmation的`fw-reset`；focused test只做dry-run，不触碰审阅机器firewall。文档明确reset清除全部临时规则，避免把它误解成close-one-port。

### 3. P2 / L1：Authenticated token不能进入日常应用URL

CLI只在server启动终端打印一次随机token。`GET /login`提供无外部asset表单；exact `POST`成功后303并设置opaque session cookie。错误token返回401，protocol-relative/control-character `next`返回400。另一server process拒绝旧cookie；API、asset与WS在无session时全部401。Navigation分类以route为准，focused回归证明`Accept: text/html`不能把API或asset变成302。

真实Chromium回归发现login response原先的`Referrer-Policy: no-referrer`会让同源form POST发送`Origin: null`，因此正确token也在Origin admission阶段收到403。改为`same-origin`后，浏览器POST发送当前server的exact Origin、返回303并进入Room；cross-origin referrer仍不会发送。Integration同时冻结response header，避免只靠手工构造Origin的测试再次漏掉该浏览器语义。

### 4. P2 / L1：Vite双端口与LAN hostname不能破坏session/Origin

Dev launcher向Bun注入固定frontend port，Vite代理`/api`与`/login`，Room bridge转发完整browser admission headers。非page source/asset同样先向Bun探测session：未登录`/src/main.ts`返回401，登录后返回200。内部fetch连接固定backend socket，同时把browser hostname与Bun port投影为逻辑`Host`；Bun因此继续要求Origin与请求URL exact hostname，`localhost → 127.0.0.1`即使双方都在allowlist也返回403。Vite与Bun共享Host allowlist，真实machine hostname不再被Vite 403；`clearScreen=false`保证稍早打印的token保持可见。Frontend WebSocket使用当前页面`location.hostname`加Bun port。

### 5. P2 / L1：Hook不能被browser cookie要求误伤，也不能获得通用bypass

Admission只识别两个Room-scoped ingest route和`x-shell-deck-ingest-token`header，并把请求交给既有validator。Focused回归用错误token证明请求到达existing structured ingest validator并以其稳定错误失败；其他API、缺header、cross-site请求均没有该入口。

## 需要人工拍板

无。本任务完全按已冻结access/listen与session contract收口。

## AI 可直接修

复审列出的六项均已直接修复；最终审阅没有遗留AI可直接修项目。

## 未覆盖与残余风险

Guest LAN明确依赖受信任局域网；它让能访问端口的设备拥有真实PTY完整能力。Authenticated只提供进入server的门锁，不提供TLS、账号、角色、rate limit、logout、device management或公网部署。Token不加密传输，因此不可信Wi-Fi或公网仍应使用HTTPS、Tailscale等加密隧道，不能直接映射shell-deck端口。

本任务不枚举手机或client IP；只枚举server自身网卡地址与machine hostname作为DNS-rebinding Host allowlist，不用于设备发现或授权用户。用户需要使用computer LAN IP/machine hostname并开放本机防火墙。Resource envelope仍由后续正式任务设计，不属于本change。

## 审阅范围

审阅`rszusqpp`相对父change `qxpqosnu`的全部source、task文档、active spec、Quickstart、README、just/CLI、Bun HTTP/WS route order、Vite page/source admission、frontend WebSocket地址、hook边界、focused/default test discovery、E2E inventory与400行Gate。验证命令严格串行，唯一并发是既有test内部的server/client或cross-process correctness oracle。
