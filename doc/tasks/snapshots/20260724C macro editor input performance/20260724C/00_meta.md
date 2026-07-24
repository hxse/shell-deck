# 20260724C Macro Editor Input Performance

## 任务概括

修复Macro Visual editor中连续输入、删除和编辑ID时的明显卡顿与焦点丢失。统一让全部Visual字段继续直接写入唯一rune draft，同时避免每次按键深拷贝并替换整份definition，也避免让可编辑业务ID直接或间接参与当前节点及其For(text-list)子编辑器的DOM identity。

## 任务级别

三星任务。问题位于全部Macro Visual字段共享的draft mutation热路径，并涉及递归Flow与Parallel编辑器的元素身份、dirty精确判断和显式Save边界；错误处理可能造成输入丢失、焦点漂移或quietly wrong draft。

## 范围

范围内：Visual editor全部input/textarea/select的共享mutation性能、Node/Lane/Parallel Action/Output ID连续编辑、For(text-list)子编辑器identity、焦点与caret稳定、dirty与draft revision语义、无隐式Save证明、focused回归测试、current spec同步。

范围外：terminal/xterm输入性能、JSON editor架构重写、Macro schema/API变更、validation规则变更、autosave、blur提交、字段级shadow draft、视觉重做和与本问题无关的性能优化。
