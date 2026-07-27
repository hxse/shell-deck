# 问题背景

## 使用场景与痛点

Authenticated LAN模式的典型入口是电脑运行server、手机连接同一Wi-Fi。当前token只打印为一行文字，手机必须人工逐字符输入或借助其他通道复制；32字符随机token在移动端既慢又容易错。

用户需要的是一个更短的物理交接流程：电脑终端直接显示QR，browser既能从相册或文件读取二维码，也能在环境允许时打开后置相机持续取景并自动识别。两个入口必须分开命名，不能用一个“相机”按钮同时承担拍照与选图，让用户猜测系统最终会打开什么。手工输入仍应保留，避免权限、Secure Context、设备兼容或拍摄环境影响基本入口。

## 候选方案

只保留`capture="environment"`最容易落地，而且plain HTTP LAN也能由部分Android browser调用系统相机；但它本质是先拍照再回传文件，不能提供用户明确要求的实时识别，并且按钮语义会把“上传”与“拍照”混在一起。

实时camera stream体验最像扫码器，但`getUserMedia`受Secure Context约束。Loopback或已有HTTPS入口可以使用，手机通过普通`http://<LAN-IP>`访问时不能依赖该API。二维码库无法绕过browser安全边界，因此实时按钮必须在不支持的环境明确失败，上传图片和手工输入继续作为正式fallback；本任务不顺带引入TLS与certificate生命周期。

解析实现继续选择`qr`：同一个零依赖package既能在server输出terminal QR，也能在browser从上传图片或camera frame的RGBA data解码。相机只使用原生`navigator.mediaDevices.getUserMedia()`获取画面，不再增加第二个scanner依赖、native `BarcodeDetector`、worker或第三方网络资源。

## 取舍结论

本任务采用“手工输入 + 上传图片 + 实时扫码”三入口。QR只承载当前raw token，不承载URL或Room；两条QR路径解析成功后都调用既有`POST /login`，所以session、constant-time token验证与Origin admission继续只有一份真值。

实时扫码不会按camera原始帧率无界解码。Camera只请求适中的720p画面，decoder canvas最长边受限；同一时间只有一个decode，最快约8次/秒，解码变慢时按工作耗时自动降频。Canvas与context复用，成功、取消、页面隐藏或离开时立即停止track。这样把性能成本限制在login页面的短生命周期内，而不引入复杂worker与第二套调度框架。

登录decoder与固定stylesheet route作为仅有的两个public login assets交付。Decoder不含token、不读取session、不发网络请求；stylesheet复用唯一compiled application CSS，不建立第二份presentation truth。除这两个精确路径外，Authenticated模式的其他asset仍要求session。
