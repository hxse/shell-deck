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

每次server process使用系统CSPRNG生成至少128-bit token，只保存在内存。Authenticated CLI先打印可人工复制的raw token，再打印payload逐字相同、4-module标准quiet zone、`quartile` error correction的terminal QR。打印前按0至7选择首个能在2/3/4 pixels-per-module clean projection中由正式browser decoder逐字round-trip的标准mask；全部失败时以`login_qr_render_unreadable`fail loudly，不能依赖library auto-mask或打印未经自检的QR。Programmatic启动不增加stdout。Token不写磁盘、配置、URL、HTTP asset或cookie，server restart后token和全部session失效。验证时对SHA-256 digest执行constant-time comparison。

未认证HTML navigation以302跳到`/login?next=<local-path>`；API、application asset和WebSocket返回401。分类以route/path为准，API携带`Accept: text/html`也不能变成redirect。`GET /login`保留手工token表单，并把QR入口明确拆成saved image upload、single-photo capture与live scan。Login gate复用唯一`src/app.css`编译出的现有Tailwind/daisyUI 5 framework，固定采用默认`business` theme，以theme-native card/input/button/alert/modal/toast和responsive utilities呈现，不依赖application JavaScript bundle或第二套control CSS。Upload使用始终可见的daisyUI `file-input file-input-ghost file-input-secondary file-input-md`原生image input，旁边的live action使用`btn btn-secondary btn-md`并具有同层label；原生selector和action直接共享framework theme、完整圆角与尺寸，不增加`::file-selector-button`特判。Pointer/touch/keyboard直接命中input，不经过透明overlay、JavaScript `.click()` proxy或label default forwarding，upload input无`capture`/`hidden`/`display:none`。独立`Take QR photo` control固定为`accept="image/*" capture="environment"`，默认隐藏且在Android UA显示；它通过系统camera取得单个File，不使用`getUserMedia`或Secure Context，并复用upload的validation/bitmap/decode/submit路径。Android Chrome与Firefox实机均确认explicit capture可以拍照、返回File并完成登录，因此不显示browser-specific warning。Module初始化和BFCache restore重置两个native file state；`touchstart`/`pointerdown`/keyboard在upload picker默认动作前清空browser-restored selection并标记handoff，但file input `click`不得清空并取消picker。两种input的选择结果同时消费`input`与`change`并按File object去重；任一照片扫描期间两个input同时busy。Upload handoff开始后以500ms低频读取`input.files`、最长两分钟，window focus/document visible把无File grace收短到1200ms，覆盖mobile browser漏发选择与return lifecycle但已安装File的路径。Browser按source orientation读取不超过20 MiB的图片，先以最长边1600 pixels解析完整canvas及center-square，再对source中心72%与48%做最长边1200 pixels的有界重试。打开picker/camera、收到File与每一遍扫描都会更新fixed toast；取消/未返回File、格式失败和未发现QR都有明确反馈。Picker只在当前tab `sessionStorage`写入开始时间；camera activity导致login renderer重载时，新页面消费该marker并提示先拍照再从Photos/files选择，不保存token或图片。实时invalid payload显示在camera modal内，不能把反馈写到遮罩后或静默失败。Live camera只在Secure Context且`getUserMedia`可用时启动，优先请求后置720p camera；普通`http://<LAN-IP>`不满足时明确提示使用HTTPS/localhost，并保留single-photo、upload与手工fallback。

实时scan复用一个canvas/context，把camera frame缩到最长边720 pixels；同一时间只有一个decode，相邻decode至少间隔125ms，并按`max(125ms, 3 × previous work duration)`自适应降频。合法token识别成功前先停止loop和所有tracks；Cancel、Escape、form submit、pagehide、document hidden与取消后迟到的stream同样必须cleanup。两条QR入口都只允许32字符base64url token并沿用现有form提交；图片/frame不上传，任意URL或其他QR文本不会导航或提交。本contract不为LAN增加TLS、certificate或不安全camera fallback。

`/login#debug`显式启用当前tab的Login diagnostics，并以现有theme UI显示readonly日志、Copy、Select all与Clear。最多保留160行/24000字符并跨login reload与server restart保存在`sessionStorage`；Copy在同步user gesture中先尝试legacy copy、再尝试Clipboard API，两者不可用时选中textarea供手工复制。日志只含page/file-picker/scan lifecycle、非识别性File元数据、bitmap/crop尺寸、decoder error code、token length与form submit，不记录token内容、File name/path、pixels或cookie，也不发送到server。相同事件同时写browser console；新stable asset遇到尚未重启的旧server login HTML时退化为no-op。

Login页面只加载固定同源module `/login-assets/login-qr.js`与stylesheet `/login-assets/login.css`。它们是Authenticated未登录状态仅有的两个public assets，Browser Origin/Host guard仍先执行；其他`/assets/**`与Vite source继续401。两个稳定asset path固定发送`Cache-Control: no-store`，不能在rebuild/restart后复用旧scanner。Production script固定生成，stylesheet route映射到唯一compiled application CSS；dev由Vite映射到相同TypeScript entry与现有`src/app.css`并先通过Bun login admission验证Host/Origin。CSP保持`default-src 'none'`并只增加`script-src 'self'`与`style-src 'self'`；camera只进入`video.srcObject`，不使用CDN、inline script/style、worker或第二scanner dependency。`POST /login`仍只接受`token`和本地`next`。成功后生成至少128-bit process-local session，303返回原path并设置：

```text
shell_deck_session=<opaque>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000
```

HTTPS额外设置`Secure`。相同browser profile与hostname的tab共享cookie；另一设备、hostname、private profile或server restart需要重新输入token。一个browser登录不会全局解锁server。

Login response使用`Referrer-Policy: same-origin`：同源form POST必须保留可由Origin guard验证的实际Origin，同时仍不向cross-origin目标发送referrer。不能使用会让Chromium把登录POST序列化为`Origin: null`的`no-referrer`。

Token不提供用户自定义或持久化。本contract也不提供账号、角色、logout、rate limit、TLS或公网暴露；不可信Wi-Fi与公网需要另加HTTPS/Tailscale等可信加密边界。

## Development server

Vite page bridge把cookie、`Origin`和`Sec-Fetch-*`转给Bun，并且只在Bun admission返回200后渲染Room page；其他source/asset也先经Bun探测，未认证返回401、cross-site返回403。两个固定login UI assets改用无session的Bun login admission后映射到browser script与compiled app CSS，不会因此公开`/src/loginQrClient.ts`、`/src/app.css`或其他source。内部fetch仍连接固定backend socket，但把原browser hostname与Bun port投影为请求`Host`，因此Bun保持exact-host校验而不需要cross-alias例外。Vite与Bun共享Local/LAN Host allowlist，machine hostname和`.local`不会被Vite单独拒绝。Vite关闭clear-screen以保留Bun启动token/QR；application WebSocket继续以当前页面hostname直连Bun port。
