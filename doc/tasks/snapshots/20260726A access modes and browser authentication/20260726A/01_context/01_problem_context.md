# Problem Context

shell-deck的真实PTY等价于本机shell能力。旧server默认只绑定`127.0.0.1`，但HTTP和WebSocket没有browser Origin安全边界；恶意网页可以尝试从受害者浏览器连接localhost。另一方面，用户明确需要电脑与手机连接同一Wi-Fi后访问同一个server，因此不能用“永远只允许localhost”回避问题。

访问控制只应是一道门锁。Room controller与content edit lease继续管理同一已进入server的browser如何取得写权；本任务不建立账号、多人协作或权限层级。用户应从启动命令一眼看出安全选择，脚本和systemd也必须可复现，因此不采用交互式Input。

最终选择两个正交的必填模式：

* `guest|authenticated`决定是否需要登录；
* `local|lan`决定绑定`127.0.0.1|0.0.0.0`。

Authenticated每次进程启动生成新token，browser输入一次后使用HttpOnly cookie。Guest不登录，但仍拒绝cross-site browser request。LAN不检测手机IP；server绑定所有网卡并只允许自身interface/machine hostname，browser沿打开页面的hostname访问API和WebSocket。开发态Vite与Bun端口不同，只允许同hostname的已知dev frontend port，不建立任意Origin allowlist。
