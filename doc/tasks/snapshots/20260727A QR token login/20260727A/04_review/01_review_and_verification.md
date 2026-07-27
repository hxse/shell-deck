# Review and verification

## 总体判断

本轮同时审阅代码和文档。20260727A已经把Authenticated token的terminal QR、图片上传解析与Secure Context实时扫码接入同一browser login主链，并把原始裸HTML收口为复用现有Tailwind/daisyUI `business` theme的responsive login gate；没有引入第二token schema、图片上传、worker、第二scanner dependency、第二CSS truth或session旁路。

范围内代码、focused tests与current docs一致，未发现遗留代码P1/P2/P3。严格仓库Close Gate尚缺一份证据：此前64项中63项通过，唯一失败是既有37 MiB PTY stress用例在主机高负载下出现116.7ms frame gap。真实Android Chrome与Firefox均已确认独立`capture="environment"`可以打开系统camera、返回File并完成QR登录；普通saved-image picker不再承担camera source contract。

## Gate 结论

Formal Document、Execution、Code、Focused Test与Current Docs Gate通过。所有project-authored code文件不超过400行；scanner共检查364个文件、exceptions为零。18个350行soft advisory中16个为既有文件，本任务新增的QR browser entry为390行、QR E2E为397行，均低于400行hard limit；新增return probe为83行。

完整unit与integration通过；完整E2E业务结果为63/64，因此严格Overall Close Gate暂不通过。主机恢复正常负载后需要重新取得一份完整`just test-e2e`绿色证据。新mask terminal QR与saved-image upload已经取得真实Android成功证据。

## Findings and Solutions

实现后自审与手机实测反馈共发现并已修复十四项：

1. Camera permission异步返回可能晚于用户Cancel。最终实现用generation冻结start，迟到stream只会停止tracks，不能恢复旧dialog。
2. Fixed QR持续出现在画面时可能反复写相同live-region status。最终browser entry会跳过相同message/state的DOM写入。
3. 第一版fake camera fixture使用data URL，受login CSP正确阻止。最终测试直接向canvas写入真实QR RGBA pixels，再通过`captureStream()`验证正式video/canvas/decoder路径，没有放宽CSP。
4. 第一版login presentation建立了第二个Tailwind CSS entry，`ui-style-residue`正确阻止第二份CSS truth。最终固定`/login-assets/login.css`在production映射到唯一compiled application stylesheet，在dev映射到现有`src/app.css`；没有放宽Style Gate。
5. DaisyUI modal入场动画使原200ms fake permission window可能在Playwright完成click前结束。最终fixture使用明确的1秒pending window，仍冻结“Cancel后迟到stream只能stop”的原语义，没有改写camera production时序。
6. 初始terminal QR沿用了library compact 2-module border，低于QR标准4-module quiet zone；同时photo错误位于mobile form底部，live invalid反馈位于modal遮罩后，真实用户可能只观察到“不登录且无报错”。最终terminal改为4-module quiet zone与不增加QR version的`quartile`纠错，photo decoder增加source orientation与rectangular center-crop retry；form status前移并滚入视野，camera status进入modal。新增无QR photo与visible modal error E2E冻结反馈。
7. 真实Android第二次复验仍然“怎么拍都不登录且无报错”。独立round-trip发现这不只是拍摄质量：`qr` auto-mask对部分合法随机token会生成同一正式decoder无法检测的clean QR；5000个`quartile`随机token中17个失败，同一server token固定导致重拍必然重复失败。最终CLI对0至7 mask依序执行2/3/4 pixels-per-module正式decoder self-check，只打印首个逐字round-trip candidate；3000个随机诊断样本全部找到mask。Upload改为fixed daisyUI toast，从picker打开起显示状态，并覆盖`cancel`、focus返回但没有File、format与decode失败；若Android camera activity回收renderer，当前tab只用sessionStorage时间戳让重载页面恢复actionable错误。照片增加完整画面、center-square、中心72%和48%的有界扫描，stable login assets改为`no-store`。新增4000×3000 JPEG小QR、三种Android handoff与auto-mask失败token corpus回归。
8. 用户进一步确认操作入口确实是login页`Upload QR image`。原实现的可见button仍通过JavaScript对`hidden` file input调用`.click()`，桌面自动化可用但没有把Android external camera handoff直接交给native control。该阶段改为透明原生file input覆盖整个daisyUI button视觉，pointer/touch/keyboard直接命中input，不经过script proxy或label forwarding；focused E2E从直接`setInputFiles`升级为真实`filechooser` event后再选择QR，并完成自动登录。Finding 11的Firefox实机证据随后进一步取消了透明overlay。
9. 真实Android随后表现为第一次上传可登录，server restart后刷新再上传无任何反馈。完整restart回归证明旧process cookie、旧Room path和新token能正确完成303并替换session，因此不是server session cache冲突；缺口在mobile browser可能恢复旧File selection、重选相同URI时不再发送可消费的`change`，且外部picker不保证触发window focus。最终module/BFCache restore重置native state，pointer/keyboard在picker activation前清空旧selection，标准`input`与`change`共同进入按File object去重的扫描，document visible与window focus共同触发无File检查。清空动作不能放在file input `click`中：专项测试证明那会让Chromium取消native picker。新增同端口server restart、旧selection与input-only三条E2E回归。
10. 同一Android复验仍然没有足够证据区分picker、bitmap、decoder和form阶段。最终增加显式`/login#debug`诊断模式：160行/24000字符ring跨reload和server restart保留在当前tab，同时显示readonly textarea、Copy/Select all/Clear并写console；Copy先在同步gesture尝试legacy copy，再尝试Clipboard API，plain HTTP仍失败时选中全文供手工复制。日志覆盖page/picker/File元数据/bitmap/decode/form lifecycle，但禁止token内容、文件名/path、pixels、cookie和网络上传。Stable asset遇到未重启旧server HTML时退化为no-op。新增跨reload日志与token非泄漏E2E。
11. Firefox Android 153第一份实机日志只出现`visibility hidden → focus → visible`，没有任何upload/File事件；第二份日志已出现`pointerdown/touchstart/focus/click`，却在`file_handoff_begin`后不再产生`input`、`change`、focus或visibility。这证明失败发生在native picker return，尚未进入bitmap、QR decoder或HTTP。最终删除透明overlay和button-styled label，改为始终可见的daisyUI `file-input-secondary`；新增`touchstart` handoff，并从click起每500ms读取`input.files`、最长两分钟，使browser漏发全部选择/return lifecycle但已安装File时仍会消费。focus/visible会把无File grace收短到1200ms，poll只在首轮、每十轮和发现File时记录。新增同时阻断两个选择事件仍通过probe登录的E2E。
12. A/B实机复验确认，同一Firefox Android从普通picker选择系统Camera预先保存的照片可以正常进入File、bitmap、decoder与登录，只有普通picker附带的camera action不返回File。这排除了shell-deck decoder、token、permission与session路径；后续Finding 14以独立explicit capture解决camera source，因此最终页面不保留Firefox warning。本task明确不扩展为QR URL登录。
13. 可见native file control的Browse selector仍呈现为input左半边，与旁边的完整semantic button层级不一致。最终直接使用daisyUI `file-input-ghost file-input-secondary file-input-md`让selector获得framework完整圆角/secondary surface，并把live action显式收口为`btn-secondary btn-md`及同层label；没有增加file-selector CSS、隐藏input、透明overlay或script click。
14. Android Chrome对现有`accept="image/*"`只提供文件选择器，没有camera action；这是无`capture`时允许的UA选择，并非页面失败。最终保留saved-image input不变，另增Android标准`capture="environment"`单张拍照入口；其File直接复用正式photo decoder，plain HTTP无需`getUserMedia`。Android Chrome与Firefox实机均确认该独立入口能够拍照、返回File并登录，因此删除过渡性的Firefox warning和对应UA特判。E2E以Android Chrome UA和4000×3000 camera fixture冻结capture显示/登录，并以Firefox UA冻结同一入口可见。

自动化修复后未发现阻断或非阻断代码Finding；saved-image QR登录已经取得真实Android成功证据。

## 需要人工拍板

无。

## AI 可直接修

无待修项。

## 未覆盖与残余风险

没有在自动化中模拟具体手机镜头的摩尔纹、反光、透视与厂商camera permission UI；自动化使用4000×3000 JPEG中的小型terminal QR、landscape projection、Chromium真实`MediaStream`、`video`、canvas与QR decoder证明控制流。Mask self-check消除了“当前token天生无法被正式decoder检测”的生成路径，多尺度扫描与fixed toast覆盖照片占比及browser handoff；真实Android saved-image与explicit capture路径均已通过。普通`http://<LAN-IP>`不是Secure Context，实时按钮会明确提示改用HTTPS/localhost；single-photo capture、上传图片与手工token是当前正式fallback，本任务不提供LAN TLS或QR URL登录。

完整E2E首次运行时，既有37 MiB PTY用例的`maxFrameGapMs`为116.7ms；当时主机load average约15、swap使用8.6/8.8 GiB。立即复验反而使另一个large replay用例也超时，且同一frame gap上升到166.7ms，因此停止继续施压。Login只增加server HTML、独立QR browser entry和复用现有application stylesheet；这项残余只影响严格全仓绿色证据，不显示本任务功能回归。

## 审阅范围

审阅了20260727A全部task文档、parent `20260726A`基线、active access/theme specs、Quickstart、README、server login HTML/admission、production/dev asset交付、DaisyUI presentation、browser upload/camera coordinator、共享decoder、unit/integration/E2E、400行Gate与jj change边界。另以Chromium真实渲染检查1440×900和390×844两种viewport，确认card层级、input、QR actions、主submit及手机纵向布局无横向溢出。

验证结果：

* `just check`：通过；364 files、limit 400、exceptions 0、18 advisories，唯一project CSS仍为`src/app.css`，Svelte 0 error / 0 warning。
* Focused E2E启动前的当前源码Vite build：通过；产物中compiled application CSS为136.69 kB，`dist/login-assets/login-qr.js`为50.70 kB。此前重复执行的独立`just build`在Dota占用约245% CPU、swap 8.7/8.8 GiB时超过50秒无输出，为避免继续施压主动停止；它不否定后续同一源码已完成的前置build证据。
* `just test-20260727a`：6 unit、4 access integration、16 Chromium E2E通过。
* `just test-unit`：347项通过，其中默认入口包含57项integration。
* `just test-integration`：57项通过。
* `just test-e2e`：63/64通过；唯一失败与原因见残余风险。
* `just diff-check`：通过。

Sandbox内Vite production build在config启动阶段持续无输出，已停止该次sandbox进程；相同正式build与所有需要local server/Chromium的Gate在sandbox外串行执行。没有并发运行build或test。
