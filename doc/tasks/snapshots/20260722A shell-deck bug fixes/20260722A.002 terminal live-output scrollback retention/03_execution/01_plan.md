# Execution Plan

## 阶段一：建立失败证据

在真实xterm DOM中生成超过viewport的history，滚到历史位置后继续发送高频output，冻结当前会回到底部的失败行为。

## 阶段二：最小修复

保留replace hydration的bottom定位；删除append parse完成后的强制bottom；resize前记录是否follow bottom，只在原本follow时恢复。

## 阶段三：自审与Close Gate

检查normal/alternate active buffer、initial hydration、hidden retained terminal与observer fit边界；运行focused/full Gates，同步active spec、review与index。
