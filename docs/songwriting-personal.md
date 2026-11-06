# 个人版写歌：月光织词 / 潮汐来信

## 本轮实现

原有歌曲书架、创建、封面、MiniMax Music 免费/付费、ACE-Step、音乐 App 联动继续使用 `apps/SongwritingApp.tsx`。写作页由独立 `components/song/SongwritingStudio.tsx` 承接，可切换浅绿月亮小羊和浅蓝海洋小狗；主题偏好保存为原有 assets 中的 `songwriting:theme`，不增加数据库表或后端。

### 一份聊天记录

用户与角色讨论直接写原有 messages，保留 user/assistant、原文和自动生成的消息 ID。metadata.source 为 songwriting，songId 标记当前作品。写歌页默认筛选本曲，也能查看当前角色完整私聊；群聊与其他角色消息不混入。没有写歌独立消息计数器、总结器或讨论摘要。

请求前重新读取角色、普通聊天有效范围和水位，复用 buildChatRequestPayload 的角色/用户/世界书/日程/情绪/记忆召回及历史处理。appPrompt 只替换场景规则、输出协议和当前歌曲资料；使用角色默认对话 API，URL/Key/Model 整套选择。不会把全部旧记录绕过范围送给模型。

songwriting-history-updated 接入 OSContext 已有 historyChanged 和 Chat 的刷新监听；只调用原有 processNewMessagesWithAutoArchive，不修改记忆核心、阈值、批次、权重或水位逻辑。事件不触发聊天模型的第二次回复。原生管线继续负责同角色的串行与去重。

### 确认后保存

支持单句、连续段落、整首候选。段落默认从所选句开始处理同类型的连续歌词；建议选择段落首句，选择末尾则新增指定段落。可指定句数和要求；整首不强制固定模板。聊天也可提出按连续范围替换的候选。

候选保存在 SongSheet.lyricProposal，刷新可恢复。接受前可预览、手改、稍后查看、取消或重新生成。明确说“就用这版”等且模型正确引用当前候选 ID 时，也可确认保存；含糊的“好”不自动操作。单句候选不得越过目标范围，段落候选不能修改其他段落；截断/无效 JSON 报错，不写空结果。

正式修改在 songs/messages 同一个 IndexedDB 事务中写歌词、lyricRevisions 和一张折叠修改卡。一次改整段也只有一张。无变化不写卡，失败全事务回滚；操作 ID 防止重试重复。候选指纹阻止覆盖后来更新的歌词，版本恢复作为新修改。手动编辑只在明确保存时提交一次。

角色回复与对应候选也在同一事务落库，避免网络重试后聊天正文与候选不一致。用户消息使用 saveMessageOnce，不因重试重复记录。

歌词定稿独立于出歌，完成卡以已完成歌词指纹去重。卡片正文含完整可读修改内容，聊天与原有记忆格式化均可读，不需要新记忆规则。

### 数据与作品

新增字段均为 SongSheet/SongAudio 的可选字段，沿用原有歌曲和 assets 备份。保留旧评论作为只读原文，不迁移、不重复写入聊天。用户本身没有使用旧写歌 App，无需历史迁移任务。

生成音频保留 audioVersions，记录对应 lyricRevisionId；原生成页可切换既有音频版本，音乐 App 继续使用选定音频。不修改 MiniMax/ACE-Step 服务实现或原有配置。

## 海绵边界：尚未正式接入

没有写入未验证的海绵 HTTP 接口，没有 Cookie、代理、MCP 或新增基础设施；不展示假可用的海绵出歌入口。

“专属歌声”页可读取当前角色的 MiniMax 音色，准备平台指定台词的测试朗读、试听和导出。生成必须由用户勾选可能消耗 MiniMax 额度并点击按钮；不自动调用。原角色 TTS 设置不改变。测试音频按角色保存在独立 assets 键中，使用 data URL 支持原备份序列化。

下一步需要用户在海绵正常登录，确认当前克隆入口、素材与合成语音规则、费用，并实测原创生成和同音色复用。验证成功后才实现独立适配层。克隆、生成、音色相似度及海绵额度仍未验证，不能称为已接通。

## 验证

- utils/songwriting.test.ts：统一消息与重试去重、批量修改原子性、取消/无变化、并发候选、完成去重、版本恢复、角色隔离、精确生成范围、真实请求上下文与角色 API、截断、原有备份往返。
- 原有 songPrompts / yueqiContext / workroomCreation / chatContextRange / memoryPalace/autoArchive 回归。
- scripts/songwriting-browser-check.mjs：390×844 移动端两套主题、生成预览不覆盖、批量接受、聊天原文和卡片、刷新历史、定稿及语音消费确认门禁。使用隔离 fixture/mock API，不消费真实模型或海绵额度。
- 运行浏览器测试先启动 Vite 5183；设置 SONGWRITING_PLAYWRIGHT_MODULE，可选 SONGWRITING_CHROMIUM_PATH。SONGWRITING_FONT_CSS 仅用于缺中文字体的测试环境。
- 全项目 TypeScript 基线存在历史诊断，比较时需忽略检出路径和行号偏移；不为本功能改动无关系统。
