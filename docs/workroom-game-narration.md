# 造物间游戏旁白

游戏操作作为 `workroom_events` 的结构化事件记录，投递为 system `workroom_card`，不能借独立回应的 user 消息冒充用户说过的话。`actor` 区分 user / char / game，`actorName` 由宿主从实际角色与用户信息中填写；组件不指定角色权限。旧卡片可继续读取。

角色动作由宿主授权一轮，bootstrap 调用已登记的 `run({actor:'char'})`。期间组件的 emitEvent 暂存，动作结束用内部 finishCharacterAction 一次提交结果和公开回应；组件已有结果时不再补一张“执行了动作”卡。未产生结果且执行失败，不声称成功。每次上报先保存 `raw:true` 的本地原始事件，再将用户短时间连续上报合并为一条旁白；原始事件不投递、不重复显示卡片，但完整备份保留。关闭页面会尽力提交已收到的事件。旁白记录公开结果，禁止把隐藏答案或整个游戏状态写入其中。自动回应只保存角色的回复，不把旁白再存成用户发言。

进入正式游戏时，`ensureGameStarted` 使用正常聊天上下文范围检查该作品的 started / progress 卡。如果没有记录，写一张带作品简介的 started 卡；同一有效上下文内重新打开不重复介绍。进度卡只记录名字、操作者和变化，模型可读文本也不重复简介。联动关闭时不产生新开始卡，游戏旁白只保存本地。

所有字段复用造物间事件表，完整备份校验通过 readWorkroomEvent 保留 actor / actorName 与 started 类型，无需数据库升级。记忆输入继续经 workroomMessageText 读取，重要性判断保持原流程。
