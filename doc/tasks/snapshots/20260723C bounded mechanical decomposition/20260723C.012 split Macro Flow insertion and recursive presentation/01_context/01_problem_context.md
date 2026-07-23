# Problem Context

## 当前问题

component script中约60-260行都是insertion domain：八个local state、anchor factory、validity effect、palette settle/close、new/move node command和movable choices。其余script是render adapter，markup则是递归presentation。

这些insertion state可由每个component实例创建的Svelte controller唯一拥有，不需要移动任何DOM或让recursive snippet变成新component。

## 拆分选择

新controller接收live draft、唯一`updateDraft`、palette mode及notice/terminal adoption ports，内部组合既有`MacroInsertionPaletteLifecycle`。component通过getters和methods绑定原markup。

tree collapse/mutation继续由现有tree controller拥有；insertion controller不吸收它，避免形成新的大一统editor controller。

## 风险边界

anchor存储必须clone body path；draft结构改变后invalid anchor立即关闭且不restore错误trigger。insert失败保持palette open并re-clamp；成功或Cancel恢复exact trigger。无MouseEvent/missing trigger继续centered fallback。
