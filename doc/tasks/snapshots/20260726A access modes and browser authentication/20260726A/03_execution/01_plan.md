# Execution Plan

## Phase 1：启动contract

为四种mode组合分别建立production/development concrete recipe，再用Just官方`alias`提供八个短入口；mode不经过shell参数解析，额外options以variadic parameter透传。删除`--host`和`SHELL_DECK_ALLOW_LAN`。CLI、dev launcher和`StartOptions`共享两个窄union与唯一host mapping；更新Playwright和现有programmatic server启动点为显式Guest + Local。NixOS firewall仅提供显式open/show/reset helper，不成为LAN launch dependency。

## Phase 2：访问门

新增一个小型access controller，只持有mode、ephemeral login token和session Set。HTTP入口在WebSocket与route dispatch前调用它；controller负责Origin/Host、login route、cookie与未认证response，不接触Room state。

## Phase 3：dev与LAN

dev launcher注入固定frontend port；Vite代理login并转发Room bridge cookie；browser WebSocket始终复用页面hostname。CLI打印authenticated token或Guest LAN warning，不做client IP detection。

## Phase 4：验证与文档

新增focused unit/integration测试，进入`just test-20260726a`及默认unit/integration discovery；同步active spec、Quickstart和README。严格串行运行check、build、unit、integration、E2E与diff/jj审计，并统计当前change新增code lines。
