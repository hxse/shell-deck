# Access Modes and Browser Authentication Contract

## 任务边界

本任务只增加进入shell-deck的browser安全门和显式网络绑定。通过门后，Room、terminal、Macro、Trace、controller lease与content edit lease能力完全不变。Room ID仍是资源标识，不是secret或authorization bearer。

旧`--host`与`SHELL_DECK_ALLOW_LAN`直接退出，不为旧CLI提供alias、migration或dual path。底层缺少任何mode都fail loudly。Authenticated不提供自定义/持久token；Guest + LAN是用户明确选择后的正式能力，不再要求第二个危险开关。

## 任务规范

### 启动入口

用户入口为八个Just原生recipe alias：

```text
just sgl | just sgn | just sal | just san
just dgl | just dgn | just dal | just dan
```

例如：

```text
just sgl
just sgn --port 5177
just san
just dal
```

三位依次表示start/dev、guest/authenticated、local/LAN network。每个alias由Just官方`alias`语法指向冻结mode的concrete recipe（例如`san := start-auth-lan`）；额外server options只通过Just variadic parameter原样透传，不由shell解析mode。可发现的长recipe继续可用。`just start`、`just dev`及其`-h|--help`形式打印映射并成功退出，不先build。底层CLI和`startShellDeckServer`独立验证；缺失分别返回`server_access_mode_required`、`server_listen_mode_required`，非法值返回`invalid_server_access_mode`、`invalid_server_listen_mode`。`local`只绑定`127.0.0.1`，`lan`只绑定`0.0.0.0`。

旧`--host`由exact CLI parser拒绝；只要旧`SHELL_DECK_ALLOW_LAN`存在（包括空值），programmatic/CLI server入口以`legacy_shell_deck_allow_lan_unsupported`退出，不能静默忽略。Guest + LAN启动时向stderr打印清晰警告，但不暂停、不二次确认。LAN启动可打印本机候选URL作为便利信息；候选地址不参与authorization，也不扫描或记录client IP。

LAN launch recipe不得自动调用`sudo`或修改host firewall。NixOS提供三个显式helper：`fw-open port="5177"`执行系统`nixos-firewall-tool open tcp <port>`，`fw-show`显示当前规则，`fw-reset`经Just原生confirm后执行system reset。Reset恢复声明式配置并清除全部临时firewall修改，不能描述成只关闭shell-deck端口。非NixOS不增加兼容fallback；缺少系统工具时fail loudly。

### Browser同源边界

全部browser HTTP与WebSocket在Room创建和任何route mutation之前检查：

* 请求hostname必须属于启动时冻结的server Host allowlist：Local只含loopback，LAN再含本机网卡地址、machine hostname与其`.local`名称；
* 若存在`Origin`，其scheme、hostname和effective port必须与请求Host对应；
* `Sec-Fetch-Site: cross-site`一律拒绝；
* production不接受任意额外Origin；
* `just dev`只允许相同scheme/hostname、端口为固定Vite frontend port的额外Origin；
* 拒绝返回HTTP 403与稳定`browser_origin_forbidden`，WebSocket不得upgrade。

server不预先知道手机IP，只枚举自己的接口地址来阻断任意自洽hostname的DNS rebinding。手机访问`http://<computer-lan-ip>:PORT`时，页面、API与WebSocket自然使用该hostname/IP。frontend production只使用relative API与`location.host`；dev WebSocket也使用`location.hostname`加Bun port，避免localhost与127.0.0.1 cookie分裂。

Room-scoped AgentEvent与structured JSON脚本没有browser cookie，继续使用现有`x-shell-deck-ingest-token`并且无`Origin`。精确的两个ingest route允许进入既有token validator；这不是Guest bypass，也不能放宽其他API。

### Authenticated token与session

每次server process启动使用系统CSPRNG生成至少128-bit、base64url token。token只存在于当前进程内存并在CLI启动终端打印一次；不写磁盘、URL、普通请求日志或配置。重启生成新token并使旧token/session失效。比较输入token时对双方SHA-256 digest使用constant-time comparison。

未认证HTML navigation以302跳转到`/login?next=<same-origin-path>`；API、asset与WebSocket返回401。分类由server route/path决定，`Accept: text/html`不能把API或asset伪装成navigation。`next`只能是以单个`/`开头的本地path，不能是absolute/protocol-relative URL。

`GET /login`返回无外部asset的token表单。`POST /login`只接受exact form字段`token`与`next`；成功后生成至少128-bit随机session ID，保存到process-local Set，并303返回原path。Cookie固定为：

```text
shell_deck_session=<opaque>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000
```

HTTPS请求额外设置`Secure`。cookie不携带token。相同browser profile与hostname的tab共享登录；另一设备、hostname、隐私窗口或server restart需要重新登录。一个browser登录不会全局解锁server。

Login HTML固定使用`Referrer-Policy: same-origin`。这让same-origin form POST发送exact Origin供admission验证，同时不向cross-origin目标泄露referrer；不得使用会使Chromium登录POST携带`Origin: null`的`no-referrer`。

### Dev边界

Vite继续承载HMR/source，Bun继续承载API/WebSocket与唯一browser admission。Vite代理`/api`与`/login`；Room page bridge必须转发`Accept`、cookie、`Origin`及`Sec-Fetch-*`安全headers，并且只有Bun返回200才交给Vite渲染，不能在guard外创建Room。所有其他Vite source/asset请求先以相同browser headers向Bun admission探测：Authenticated无session返回401，cross-site返回403，session合法才由Vite继续提供资源。Bridge/probe的socket target可以保持固定loopback backend origin，但逻辑请求`Host`必须使用原browser hostname与Bun port；不能通过允许`localhost`与`127.0.0.1` cross-alias来适配proxy。

Vite `allowedHosts`与Bun使用同一启动时Host allowlist，因此LAN IP、machine hostname与`.local`行为一致。Vite关闭clear-screen，保证Bun只打印一次的authenticated token不会被随后启动的frontend清掉。WebSocket直连同hostname的Bun端口。仅dev launcher注入固定frontend port，不能由普通production请求声明额外Origin。

## 示例

Authenticated + LAN：

```text
$ just san
shell-deck login token: <opaque>
shell-deck listening on http://0.0.0.0:5177
```

Guest + LAN：

```text
$ just sgn
WARNING: guest LAN mode gives every device that can reach this port full shell-deck capability.
```

Cross-site网页发起的请求：

```text
Origin: https://evil.example
Host: 127.0.0.1:5177
→ 403 browser_origin_forbidden
```

## 测试

Focused Gate必须证明：

1. Just八个官方alias的exact mode展开、options透传、start/dev help行为、NixOS firewall helper dry-run，以及CLI四种组合、必填/非法mode、旧`--host`与旧LAN环境退出；
2. local/LAN映射到精确bind host，Guest LAN warning存在；
3. same-origin Guest HTTP/WS允许，cross-site在任何Room mutation前403；
4. Authenticated navigation redirect、API/asset/WS 401、错误token 401，并冻结login response的same-origin referrer policy；
5. 正确token设置exact cookie，session允许后继HTTP/WS，另一server instance拒绝旧cookie；
6. token不进入URL/HTML/cookie，next拒绝open redirect；
7. Hook/submit-json继续只以Room identity与ingest token进入；
8. 真实Vite behavior证明page bridge转发cross-site headers且拒绝前不创建Room、Authenticated source 401/session后200、LAN machine hostname可用、内部Host投影与allowlisted cross-alias 403、clear-screen关闭，并冻结same-host WebSocket地址；
9. focused、check、build、完整unit/integration/E2E与diff-check严格串行通过；
10. 当前change新增code lines不超过400，所有project-authored code文件不超过400行。
