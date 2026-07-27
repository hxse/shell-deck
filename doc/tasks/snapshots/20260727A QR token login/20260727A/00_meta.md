# 20260727A QR token login

## 任务概括

Authenticated server启动时在明文token之后打印同内容的终端QR；未登录页面保留手工输入，同时提供“上传二维码图片”和“实时相机扫码”两个独立入口，在browser本地解析QR并沿用既有login POST完成登录。

## 正式级别

二星任务。改动跨越server启动输出、未认证页面、production/dev asset交付、第三方依赖与browser E2E，但既有token、session、Origin和Room admission contract保持不变。

## 范围

范围内：`qr`零依赖库；terminal QR生成；两个精确public login UI assets；复用现有DaisyUI `business` theme的responsive login gate；上传图片解析；Secure Context中的`getUserMedia`实时扫码；受限分辨率、单任务、自适应频率与camera cleanup；token校验、自动提交、focused测试、current docs和Close Gate。

范围外：为LAN新增HTTPS/TLS或certificate管理；在plain HTTP LAN绕过Secure Context限制；账号/角色、持久token、QR URL、图片上传、logout与authentication协议重做。
