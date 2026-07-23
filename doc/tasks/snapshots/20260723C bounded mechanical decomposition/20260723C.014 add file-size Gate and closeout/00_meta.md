# 20260723C.014 Add File-Size Gate and Closeout

## 任务概括

前十三个child完成后，本task增加一个默认file-size Gate：全部project-authored code source最多400行且没有例外。scanner从repo root发现root config/entry、JS/TS variants、Svelte、CSS、native helper及其他显式code type。随后运行整栈Close Gate并同步active truth。

## 正式 task 级别及定级原因

三星任务。静态Gate会进入默认`just check`并约束全部后续开发；错误scope可能漏掉root config、JS、CSS或native helper，任何authored-source豁免都会让规则失效。Closeout还要证明十四个child组合后无行为回归。

## 范围内

* 新增deterministic file-size scanner、unit test和`just file-size`。
* 将Gate接入默认`just check`。
* 运行full check/build/unit/integration/E2E/diff和change conflict审计。
* 同步active specs、root/index状态并写root/child implementation review。

## 范围外

* 不在`.014`继续拆production/test或修复前序child遗漏。
* 不新增任何authored-source豁免、不提高400上限。
* 不重新引入`.013`已删除的historical journey或hash-only oracle。
