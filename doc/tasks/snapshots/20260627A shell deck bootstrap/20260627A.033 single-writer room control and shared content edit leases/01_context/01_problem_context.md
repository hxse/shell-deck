# Problem Context

## 为什么Room同步还不等于安全

.032允许同一用户在多个标签页或设备打开同一Room URL，并同步terminal、Text与runner状态。若每个连接都能写，两个设备仍可能同时发送输入、重排terminal或Start/Stop runner。server queue只能决定请求到达顺序，不能表达用户意图，也不能防止后到请求覆盖先前界面看到的状态。

产品语义不是多人协作，而是同一用户在设备之间接续操作。因此最小且一致的模型是：一个Room只有一个controller；其他连接都是observer。观察者可以读取所有同步状态，但不能改变共享Room真值。需要换设备时显式Take Control，而不是允许两个writer竞争。

同一标签页的reload或短暂WebSocket重连不是换设备。若它在断线前就是controller，刷新后要求用户再次点击Take Control会让全部shared controls看似无故失效。客户端因此只保留一个不含grant的session-scoped ownership intent，并在5秒内等待Room进入available后走正常epoch-bound acquire；它不能对仍存在的controller执行takeover，也不能让普通observer自动晋升。

## 为什么Room controller还不够

Macro与Library不属于Room，而是同一User Data Root中的user-global内容。两个不同Room甚至两个不同server process可以同时打开同一record。如果只做Room controller，每个Room各自都有writer，仍可能同时编辑同一Macro/Library并产生覆盖或复杂冲突。

因此需要第二层、粒度不同的控制：

    Room controller
      └── 约束一个live Room中的共享runtime mutation

    Content edit lease(resource key)
      └── 约束一个user-global Macro/Library record的编辑

两层不能合并。Room controller是process-local、memory-only且随Room generation消失；content edit lease必须跨Room/process协调，但只锁一个record，不阻止其他record并行编辑。

edit lease对应一次连续Edit session，而不是一次Save请求。Save后用户通常还会继续修改；若每次Save都释放lease并把表单切回只读，dirty Start内部Save也会把仍在操作的Macro突然变灰。正确边界是Save更新base revision但保留lease，直到用户Done/Cancel、切换内容、删除、离开editor或失去Room control才释放。New record在Create前没有lease，Create后若继续编辑则必须先取得fresh record lease。

## Lease不替代revision

edit lease可能因crash、network loss、TTL或显式takeover而变化。即使当前持有lease，client保存时看到的record revision也可能已经过期。因此所有update/delete仍必须携带expected revision。lease回答“当前谁有资格提交”，revision回答“提交是否仍基于当前版本”；两项都通过才允许mutation。两项的最后复核还必须和record atomic replace处于.032同一个canonical per-resource transaction guard中，否则takeover仍可能插入“已检查lease、尚未写record”的窗口。

## 本地交互与共享mutation

observer并不是整个页面失效。scroll、terminal/Macro selection、collapse、panel width、filter、clipboard Copy等只影响本client，可以继续使用；Macro切换不再隐式Prepare。terminal input、Text内容、terminal lifecycle/order、runner控制、用户显式点击`Prepare terminals`、保存/删除长期内容等会改变共享真值，必须由server验证controller。Macro/Library的New draft在首次保存前只是client-local，不占用已有record lease；编辑saved record必须先取得对应lease。

.032的Room Home是独立process management surface，不加入某个Room，也不取得controller。Home New只创建runtime；Home Destroy携带expectedRoomGeneration，在Room manager queue中显式终止目标runtime并撤销其controller/leases。它是Room lifecycle exception，不是observer绕过普通Room mutation。Room工作区内的terminal、runner和content操作仍全部受controller guard。

## 任务交接

.032提供Room/client identity、User Data Root、canonical resource transaction guard与revision primitive；本任务在其上建立generic control/lease enforcement。.034负责MacroDefinitionV3、Macro editor与runner，并消费macro record lease；.035负责Library record/editor并消费library item lease。后继任务不得复制另一套互斥、以UI disabled替代server检查，或让lease承担schema/runtime validation职责。
