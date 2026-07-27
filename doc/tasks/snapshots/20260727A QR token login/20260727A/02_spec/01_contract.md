# QR token login contract

## 任务边界

本任务只缩短Authenticated token从server terminal到browser login form的输入路径。Token生成、长度、随机性、process lifetime、constant-time验证、session cookie、Origin/Host admission和登录成功后的redirect完全沿用`20260726A`。

交付停止线是：authenticated CLI启动输出可被browser识别的terminal QR；`/login`明确提供上传图片与实时相机两个入口，本地解析合法token并提交；实时scan有明确的Secure Context失败语义和工作量边界；手工输入与错误路径不退化；production和dev均可加载固定login script与stylesheet；没有图片上传或token URL。

为LAN增加HTTPS、TLS、certificate或反向代理信任配置仍为范围外。当前plain HTTP LAN不为`getUserMedia`增加兼容分支；不支持实时相机时，上传图片和手工输入继续可用。Native `BarcodeDetector`、账号系统与Room QR也不进入本任务。

## 任务规范

### QR payload与terminal输出

QR payload必须逐字等于当前process的raw login token。不得包装成URL、JSON或带prefix的第二种token格式，也不得把token写入文件、HTTP asset或普通应用URL。

只有CLI authenticated启动输出QR；programmatic `startShellDeckServer()`不新增stdout副作用。CLI先保留可人工复制的一行：

```text
shell-deck login token: <token>
```

随后使用`qr` package的terminal renderer输出同一token的QR。Terminal QR固定使用4-module标准quiet zone与`quartile` error correction；当前32字符token仍保持在同一QR version，典型80-column terminal内不换行，同时提高真实拍屏对背景、轻微遮挡与反光的容错。

不得信任library自动mask能够被同一library稳定检测。CLI打印前按0至7顺序尝试标准mask；每个candidate必须在2、3、4 pixels/module三种clean raw projection中均由正式`decodeLoginTokenImage()`逐字读回当前token，选择首个通过者。八个mask均失败时以`login_qr_render_unreadable`终止启动输出，不能打印一个未经自检的QR，也不能改变token payload。该自检只属于CLI presentation，programmatic server启动不产生额外stdout。Guest模式不生成token，也不输出QR。

### Login页面

`GET /login`继续提供`token` password input、hidden `next`与普通submit。页面增加：

* 一个带明确`Upload QR image` label、使用daisyUI `file-input file-input-secondary`视觉且始终可见的原生file input，固定为`accept="image/*"`且无`name`，不设置`capture`、透明overlay、`hidden`或`display:none`；
* 一个`Scan with camera`按钮；
* 一个原生`dialog`，包含实时`video`预览、明确的关闭按钮和取景提示；
* 一个使用daisyUI `toast`固定在viewport上方的`role="status"`结果区域，返回外部相机后无需依赖原滚动位置即可看到；
* 一个固定同源stylesheet：`/login-assets/login.css`；
* 一个同源module script：`/login-assets/login-qr.js`。

Login gate使用项目现有Tailwind/daisyUI 5框架，不另建第二套component CSS。页面固定使用项目默认`business` theme，使用theme-native `card`、`input`、semantic `button`、`alert`、`badge`与`modal`，并以responsive utilities在手机宽度把两个QR入口纵向排列。原生file control固定使用`file-input file-input-ghost file-input-secondary file-input-md`，live action使用`btn btn-secondary btn-md`，两者拥有相同层级label并由framework提供完整圆角、semantic surface与尺寸；不得新增`::file-selector-button`CSS、透明overlay或button proxy。登录页不得依赖application JavaScript bundle、CDN、inline style或手写control特判；固定login stylesheet route在production映射到唯一`src/app.css`的编译产物，在dev映射到Vite处理的同一source。

Camera modal拥有自己的visible live status。Modal打开时，starting、instruction与invalid-payload反馈只写入modal status，不能写到遮罩后的form；modal关闭或camera不可用时，反馈写入fixed form toast。打开file picker前立即显示等待状态；Android外部camera取消、没有返回File或照片解析失败都必须替换为明确反馈，不能静默留在原页。Picker handoff只在当前tab `sessionStorage`保存开始时间，不保存token、图片、路径或扫描结果；若camera activity导致renderer回收并重载login page，10分钟内的新页面必须消费该marker并提示先拍照、再从Photos/files选择。照片未发现QR时必须提示保留完整QR及白色quiet zone并避开screen glare。

Pointer/touch/keyboard必须直接命中可见原生file input，不得经过透明overlay、JavaScript button proxy、label default forwarding或`.click()`；这是Android Firefox external picker的ownership边界。Browser可能在BFCache/page restore后保留上一次File selection，因此module初始化与BFCache restore必须重置native input；`touchstart`/`pointerdown`/keyboard activation在picker默认动作之前清空旧selection并冻结handoff，file input的`click`只显示状态、不得清空并取消native picker。选择结果同时消费标准`input`与`change`事件，并按同一File object去重；handoff开始后还必须以500ms低频读取`input.files`、最长两分钟，window focus/document visible把无File grace收短到1200ms。这样mobile browser只发送一个事件、漏发二者、甚至不发送任何return lifecycle但实际安装了File时都能进入一次扫描；poll只在首轮、每十轮和发现File时写日志，不能制造高频DOM/storage工作。选择后只在当前browser内完成以下步骤：

Android browser对无`capture`的image input是否同时提供camera属于合法UA选择；saved-image upload不得依赖该附加action。页面因此增加独立`Take QR photo`原生input，精确使用`accept="image/*" capture="environment"`，默认隐藏并在Android UA下显示；它请求系统后置camera拍摄单张照片，不是实时scan，也不依赖Secure Context。Capture的`input`/`change`进入与saved image完全相同的File object去重、20 MiB validation、bitmap、三遍decode与form submit；两条photo路径扫描期间必须同时disabled/busy，cancel、renderer reload和错误仍进入现有fixed status/marker语义。Android Chrome与Firefox实机均已确认该explicit capture native intent可以返回File并完成QR登录；页面不得再显示Firefox-specific warning。

1. 拒绝非image文件和超过20 MiB的文件。
2. 以EXIF/source orientation解码bitmap；不支持该option的browser回退到普通bitmap decode，二者都失败时明确提示photo format不可读。
3. 第一遍按比例缩小到最长边不超过1600 pixels，读取canvas RGBA `ImageData`。
4. 先对完整照片调用`qr/decode.js`；矩形照片失败时使用library的center-square crop。仍未识别时，对source bitmap中心72%与48%区域分别缩放到最长边不超过1200 pixels再重试，在不上传照片的前提下覆盖高分辨率手机照片中QR占比很小的场景。每一遍前先让出一个paint frame并更新`pass N of 3`，不得让用户只看到无反馈的同步长任务。实时camera仍只做单次decode，不能把照片fallback成本带入8 FPS loop。
5. 只接受与当前login token格式相同的32字符base64url文本。
6. 成功时填入现有token input并调用现有form的`requestSubmit()`。
7. File picker取消/未返回File、无QR、非法payload或读取失败时留在login page，清空file input并在fixed visible status显示actionable错误；外部picker返回后的检查同时由window focus与document visible触发，不能依赖某一种mobile lifecycle event；不得提交任意扫描文本。

两个固定login assets统一发送`Cache-Control: no-store`。因为script使用稳定path而不是content hash，browser不得在server rebuild/restart后复用旧scanner实现。

图片、pixel data和扫描结果不得通过新增HTTP请求上传。Picker handoff marker只含毫秒时间戳，成功/取消/返回File/return timeout时清除，重载恢复时读取一次后删除。成功提交仍只有现有`token`和`next`两个form字段。

### Login诊断日志

普通login页面不显示诊断UI。用户显式打开`/login#debug`后，当前tab在`sessionStorage`冻结diagnostics-enabled状态，并展开一个使用现有theme utilities、readonly textarea与daisyUI buttons的`Login diagnostics`面板；form POST、login page reload和server restart不会清掉该tab日志。面板固定保留最近160行且总文本不超过24000字符，提供`Copy debug log`、`Select all`和`Clear`。Copy必须先在同步user gesture中尝试Firefox可用的legacy copy，再尝试Clipboard API；两者都不可用时完整选中textarea并提示使用browser copy action，不能静默失败。每条日志同时写入browser console。

日志只记录page lifecycle、picker pointer/keyboard/click、`input`/`change`/`cancel`、File count/type/size/lastModified、bitmap尺寸、每遍crop/scale、decoder结果code、token length和form submit。不得记录token内容、File name/path、图片pixel或session cookie；不得新增日志上传endpoint或网络请求。固定login asset在旧server HTML仍未包含diagnostic controls时必须退化为no-op，避免running server与刚build的新stable asset短暂版本错配导致login脚本崩溃。

### 实时相机与性能

点击实时扫码按钮前必须同时检查`window.isSecureContext`与`navigator.mediaDevices.getUserMedia`。不满足时不得请求camera，页面留在login并显示“实时扫码需要HTTPS或localhost”；这不是silent disabled control。

支持时打开dialog并请求：

```json
{
  "audio": false,
  "video": {
    "facingMode": { "ideal": "environment" },
    "width": { "ideal": 1280 },
    "height": { "ideal": 720 },
    "frameRate": { "ideal": 15, "max": 30 }
  }
}
```

Browser可以根据设备能力选择最接近的stream；decoder不得直接按camera原始分辨率或原始frame rate工作。实现必须复用一个canvas和2D context，把完整video frame按比例缩到最长边不超过720 pixels，再交给共享`decodeLoginTokenImage()`。

实时loop必须满足：

1. 同一时间最多一个frame decode，前一次完成前不得排入下一次。
2. 相邻decode开始时间至少相隔125ms，即最快8 FPS。
3. 设一次canvas读取与decode耗时为`D`，下一次开始间隔至少为`max(125ms, 3D)`；这把持续解码工作占比限制在约三分之一，慢设备会自然降频。
4. 无QR时继续等待；发现非token QR时提示错误但不提交、不导航；发现合法token时先停止loop和全部camera tracks，再填入input并提交。
5. Permission拒绝、没有camera或stream启动失败必须关闭dialog、停止已取得的tracks并给出稳定错误。
6. Cancel、dialog Escape、form submit、`pagehide`或document变为hidden时必须停止timer、停止每条`MediaStreamTrack`、清空`video.srcObject`并关闭dialog。
7. Start期间的异步permission/video race使用generation校验；已经取消的旧start即使之后取得stream，也只能立即停止该stream，不能恢复旧camera session。

本任务不引入worker。Login页面没有其他持续交互，受限frame size、单任务与自适应频率是当前性能停止线；后续只有真实设备证据表明该边界仍不足时才另立worker任务。

### Public login asset

`/login-assets/login-qr.js`与`/login-assets/login.css`是Authenticated模式仅有的两个未登录public assets，且只接受无query的`GET`。Browser Origin/Host guard仍先于例外执行。其他`/assets/**`、Vite source、API和WebSocket保持原401/403 contract。

Production build必须把browser entry固定输出到script路径；Bun把固定stylesheet route映射到`dist/assets`中唯一的compiled application stylesheet。Dev由Vite把相同路径分别映射到TypeScript entry与现有`src/app.css`，并先借Bun login admission验证原browser request的Host/Origin，不能靠开放全部Vite source实现。

Login CSP增加`script-src 'self'`与`style-src 'self'`，仍保持`default-src 'none'`、`form-action 'self'`、`base-uri 'none'`与`frame-ancestors 'none'`。Camera stream只进入`video.srcObject`；不使用CDN、inline script/style、worker或第三方网络资源。

### 依赖与所有权

项目只增加一个精确版本的runtime dependency `qr`。Server只消费terminal encoder；browser entry只消费decoder。Token格式由共享小模块定义，生成与扫描校验不得各自复制长度或regex真值。

所有新建或本任务触及的基线未超限代码文件必须不超过400物理行。

## 示例

主链：

```text
$ just san
shell-deck listening on http://0.0.0.0:5177
shell-deck login token: AbCd..._32_chars
<terminal QR containing exactly AbCd..._32_chars>
```

Browser打开login后：

```text
/login -> Upload QR image -> local decode --------------------┐
       -> Scan with camera -> secure-context camera loop -----+-> existing POST /login
       -> manual token ---------------------------------------┘
       -> shell_deck_session cookie -> original Room path
```

关键失败例：

```text
QR payload = https://example.invalid/
结果 = 页面提示不是shell-deck token；不提交、不导航、不请求该URL
```

```text
page = http://192.168.1.23:5177/login
action = Scan with camera
结果 = 提示实时扫码需要HTTPS或localhost；不调用getUserMedia
fallback = Upload QR image或手工输入
```

```text
GET /assets/index.js without session
结果 = 401

GET /login-assets/login-qr.js without session, valid same-origin request
结果 = 200 JavaScript

GET /login-assets/login.css without session, valid same-origin request
结果 = 200 CSS
```

## 测试

Focused tests必须证明：

* 24-byte random token与browser validator共享并只接受32字符base64url；
* authenticated terminal presentation同时保留明文token并输出QR，guest无输出路径；
* login HTML含business theme、DaisyUI card/input/button/modal、手工input、可见`file-input-secondary` upload control与独立live按钮、无`capture`/透明overlay/`hidden`/`display:none`的file input、camera dialog/video、form/modal两个可见status、固定stylesheet与script；
* 两个exact login assets未登录可读，任意其他asset仍401，cross-site login asset仍403；
* browser上传由真实token生成的QR image后自动登录并进入Room，非token QR与无QR图片不会提交；
* 同一browser先登录、保留旧session cookie、同端口重启server、刷新旧Room并上传新QR后，旧cookie被新process session替换且回到原Room path；
* browser-restored的旧File selection在pointer picker activation前清空，只有`input`而没有可消费`change`时仍扫描且只扫描一次；
* `input`与`change`都被mobile漏发、但`input.files`已安装File时，focus return probe仍消费并登录；
* `/login#debug`显示tab-local日志，picker事件和return timeout可见，reload后旧日志仍存在，日志中不包含当前server token；
* 4000×3000 camera photo中的小型terminal QR可通过有界中心多尺度fallback登录，file picker cancel在fixed toast中可见；
* 外部camera恢复focus或document visibility但不发File/cancel，以及camera期间login page reload两条Android handoff失败路径都显示actionable fixed toast；
* landscape photo走照片decoder，terminal QR冻结4-module quiet zone、quartile纠错与跨2/3/4 module scale的deterministic mask self-check；
* 已知auto-mask失败token与至少256个deterministic token corpus都能选择mask并由正式decoder逐字round-trip；
* 不支持Secure Context/mediaDevices时不调用camera并显示fallback提示；
* fake camera stream中的真实token QR会自动登录，invalid payload在modal内可见，Cancel、成功、pagehide与异步start race均停止tracks；
* frame尺寸不超过720，调度最快8 FPS、慢decode按三倍耗时降频、任一时刻最多一个decode；
* production提供固定login script与stylesheet routes，dev rewrite不公开其他source；
* `just file-size`、`just check`、`just build`、focused test、完整unit/integration/E2E与`just diff-check`串行通过且无warning。
