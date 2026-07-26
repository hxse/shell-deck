# Pre-review

## 总体判断

文档把安全门、网络绑定、Room controller和Hook token拆成四个清楚边界，没有把authentication误建模为用户/角色系统。四种组合、current-schema CLI cutover、同源规则、dev例外和失败语义均可直接验收，可以进入实现。

## 风险检查

* access gate必须早于WebSocket upgrade与Room route，避免未认证请求先创建Room；
* login `next`必须限制为本地path，token不能进入URL或cookie；
* Origin校验必须比较当前请求hostname，不能硬编码localhost或枚举手机；
* dev额外端口只能由launcher注入，production不能接受request-controlled allowlist；
* Hook route只能交给既有ingest-token validator，不能把header存在误当成验证成功；
* authenticated session只属于进程内存，不能落入User Data Root；
* 现有controller/content lease contract在access gate之后保持不变。

## Gate

Formal Document与Execution Gate通过。范围没有待人工拍板分叉；停止线是完成当前四种模式和browser admission，不扩展TLS、账号、rate limit或公网部署。
