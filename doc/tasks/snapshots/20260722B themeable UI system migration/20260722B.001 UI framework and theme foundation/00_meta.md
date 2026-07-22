# 20260722B.001 UI Framework and Theme Foundation

## 任务概括

为全面UI迁移建立唯一framework foundation：接入Tailwind CSS 4与daisyUI 5，注册全部35个内置theme，新增`system` preference，将browser settings从exact v2 hard cut到exact v3，并只在Room现有Settings popover加入一个Theme selector。此阶段允许旧style继续承担尚未迁移surface，但不得开始第二套并行theme实现。

## 正式 task 级别及定级原因

三星任务。

代码改动集中在frontend build、theme/bootstrap、browser settings和App Settings，但它定义后续所有surface使用的theme真值。错误会造成首屏闪烁、旧schema被悄悄兼容、OS theme listener泄漏或Room级状态污染，因此需要完整contract和focused browser Gate。

## 范围内

* 增加并lock Tailwind/daisyUI所需dependency与Vite integration。
* 建立唯一theme catalog、strict validation、document application和system media lifecycle。
* browser settings key/schema直接升级到v3，加入`theme` exact field。
* stylesheet与application module前由同步head bootstrap应用initial Theme，`main.ts`在mount前复核，App state变化时立即更新document。
* 在现有Settings control stack加入唯一Theme selector及可访问/test contract。
* 增加foundation unit/browser tests，并更新直接受影响的current settings inventory。

## 范围外

* 全面迁移App/Room/terminal/Macro/Library visual style。
* 删除尚有consumer的旧CSS或修改旧style tests以假装migration已经完成。
* 新增topbar theme toggle、Home Settings、theme gallery、preview modal或自定义theme editor。
* 修改server、Room message、controller、terminal protocol、Macro/Library schema或runner。
* 读取、转换或删除`v2`settings value。

## 决策归属

本子任务执行根任务已拍板的framework与入口位置。AI可按formal contract选用最小module边界并实施；如果library integration要求改变现有DOM hierarchy或额外入口，必须视为方案不符合，而不是扩大任务。
