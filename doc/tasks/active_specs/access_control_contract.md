# Access Control Contract

## 启动模式

shell-deck server必须显式选择两个互相独立的current mode：

```text
accessMode = guest | authenticated
listenMode = local | lan
```

用户入口使用Just原生concrete recipe与`alias`。Production为`sgl/sgn/sal/san`，development为`dgl/dgn/dal/dan`；三位依次表示start/dev、guest/authenticated、local/LAN network。长recipe（如`start-auth-lan`）保留可发现性，`start`/`dev`及其`--help`形式只打印映射且不build。额外options由Just variadic parameter原样透传，不在shell中解析mode。CLI与programmatic入口仍独立验证缺失/非法mode；旧`--host`被拒绝，只要旧`SHELL_DECK_ALLOW_LAN`存在就以`legacy_shell_deck_allow_lan_unsupported`退出。`local`绑定`127.0.0.1`，`lan`绑定`0.0.0.0`。四种组合都合法；`guest lan`启动时打印完整能力暴露警告，但不要求第二次确认。

LAN recipe不自动提权或修改host firewall。NixOS-only helper `fw-open [port]`使用系统`nixos-firewall-tool`临时开放TCP端口，默认5177；`fw-show`显示规则；`fw-reset`使用Just原生confirm后恢复声明式firewall配置。Reset影响全部临时firewall修改而非单一端口。非NixOS不提供兼容实现。

两种access mode通过门后具有完全相同的Room、terminal、Macro、controller、Trace和evidence能力。鉴权不建立账号、用户、角色或权限等级，Room ID也不是secret。

## Browser admission

Browser HTTP与WebSocket在upgrade、Room创建及route mutation之前统一admit。请求hostname必须属于启动时冻结的server Host allowlist：Local只含loopback，LAN再含本机网卡地址、machine hostname与其`.local`名称，任意自洽hostname不能借DNS rebinding进入。存在`Origin`时必须与请求Host同scheme和exact hostname；production还要求相同effective port，dev只额外接受固定Vite frontend port。`localhost`与`127.0.0.1`即使都在allowlist也不能cross-alias。`Sec-Fetch-Site: cross-site`拒绝，失败返回403 `browser_origin_forbidden`，WebSocket不upgrade。

Server不发现或登记手机IP，只读取server自己的interface/hostname建立Host allowlist。LAN client用computer LAN IP或machine hostname加载页面；frontend API保持relative URL，production WebSocket使用`location.host`，dev WebSocket使用`location.hostname`与Bun port。每个client只需让自己的page/API/WebSocket同源。

Room-scoped AgentEvent与structured JSON命令没有browser cookie。只有携带`x-shell-deck-ingest-token`的精确ingest route可进入既有Room/launch/token validator；其他API不能绕过browser session。

## Guest

Guest不显示login、不要求session，适合用户明确选择的trusted local/LAN环境。同源保护仍执行。Guest不提供弱化后的产品能力，也不能被当作公网模式。

## Authenticated

每次server process使用系统CSPRNG生成至少128-bit token，只保存在内存并由CLI打印一次。Token不写磁盘、配置、URL或cookie，server restart后token和全部session失效。验证时对SHA-256 digest执行constant-time comparison。

未认证HTML navigation以302跳到`/login?next=<local-path>`；API、asset和WebSocket返回401。分类以route/path为准，API携带`Accept: text/html`也不能变成redirect。`GET /login`提供无外部asset的表单；`POST /login`只接受`token`和本地`next`。成功后生成至少128-bit process-local session，303返回原path并设置：

```text
shell_deck_session=<opaque>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000
```

HTTPS额外设置`Secure`。相同browser profile与hostname的tab共享cookie；另一设备、hostname、private profile或server restart需要重新输入token。一个browser登录不会全局解锁server。

Login response使用`Referrer-Policy: same-origin`：同源form POST必须保留可由Origin guard验证的实际Origin，同时仍不向cross-origin目标发送referrer。不能使用会让Chromium把登录POST序列化为`Origin: null`的`no-referrer`。

Token不提供用户自定义或持久化。本contract也不提供账号、角色、logout、rate limit、TLS或公网暴露；不可信Wi-Fi与公网需要另加HTTPS/Tailscale等可信加密边界。

## Development server

Vite page bridge把cookie、`Origin`和`Sec-Fetch-*`转给Bun，并且只在Bun admission返回200后渲染Room page；其他source/asset也先经Bun探测，未认证返回401、cross-site返回403。内部fetch仍连接固定backend socket，但把原browser hostname与Bun port投影为请求`Host`，因此Bun保持exact-host校验而不需要cross-alias例外。Vite与Bun共享Local/LAN Host allowlist，machine hostname和`.local`不会被Vite单独拒绝。Vite关闭clear-screen以保留Bun只打印一次的token；application WebSocket继续以当前页面hostname直连Bun port。
