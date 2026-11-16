# API 调用记录｜个人版同步范围（2026-11-16）

「设置 → API 调用记录」跟踪 LLM 对话请求的用途、所属 App/角色、Token（包含服务商报告的缓存读写）、状态以及响应的真实模型。调用次数不等于用户发送消息次数：工具、识图、记忆处理等独立的 LLM 请求可能分别计数。

## 本次已同步：浏览器侧用途归属

- `context/OSContext.tsx` 的原有全局请求记录/拦截器不重写；各 App 的 `fetch` / `safeFetchJson` 在原请求基础上填写 `__sullyMeta` 或安全函数的参数，明确 `appId`、`appName`、`charId`、`charName`、`purpose`。用户、角色、主/副 API 凭据和模型请求正文均不改变。
- `utils/apiCallLog.ts` 的 `resolveApiCallMeta`：显式填写任意元数据时不再混入当前前台的环境上下文，避免后台任务误记成正在浏览的私聊；缺中文 App/角色名时只按同源 ID 补显示名。完全没传元数据时仍沿用原前台快照兜底。
- 保留既有 IndexedDB `api_call_logs` 的 5 天/200 条保留策略、流式 Token/缓存读取/缓存写入的原解析与 API 费用口径，不做批量迁移或数据清空。
- `ApiCallRoute` 的新云端路由和终态记录 helper 属于**前端结构准备**，不会自己让 Cloudflare Worker 开始上传新用途或多轮用量。

## 仍待后续独立适配：Worker 云端记账

当前已实现的云端记账以 `cloud-instant-chat`（即时对话）与 `cloud-plate-consolidate`（门牌整理）为主；浏览器离线时 Worker 运行的情绪评估、Cron 定时消息、模型执行后跳过轮次、诊断用量与多轮工具累计，尚未整体融合到个人版云端端点。不得拿作者旧 `worker.bundle.js` 或旧版标识覆盖我们 `2026-11-16.1` 的 CORS 修复。

待补的云端阶段须单独：按 Worker 当前实际源码融合、保证 bundle 一致、测试 SQLite/D1 与跨设备收件箱幂等、确认敏感 Key/URL 不通过推送回传，真正部署 Cloudflare Worker 并通过线上只读版本验证后，才可宣称云端完整。

## 验证与安全

`utils/apiCallLog.test.ts` 覆盖 API meta 归属和现有 Token 算法；另外回归 `utils/anthropicApi.test.ts`、`utils/geminiApi.test.ts`、`utils/characterApi.test.ts`、`utils/amsgInstantChat.test.ts`、`utils/personalInnerVoice.test.ts` 及构建。原生记忆提取、召回、权重和盒子算法不改变；Claude 缓存断点不改变；禁止上传真实 Key、隐私输入或计费测试数据。
