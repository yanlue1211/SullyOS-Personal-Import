# 心象与聊天正文的分离

`utils/assistantThinking.ts` 是个人版前台 API、聊天后处理与流式预览共用的纯解析器。本轮先安全同步前台路径；主动消息 Worker 暂时保留个人版现有逻辑与已部署的 CORS 补丁，云端结构化 thinking 对齐需要单独源码/bundle/生产验收。判断依据是接口字段或明确的内联标签，不根据模型别名、语言或分析语气猜测。

## 支持的响应

- OpenAI 兼容的 `choices[].message` / SSE `choices[].delta`：`reasoning_content`、`reasoning`、`thinking`。空占位字段不能遮住后面的有效字段；同时出现的别名视为镜像，避免重复。
- `reasoning_details` 中的 `reasoning.text.text` 和 `reasoning.summary.summary`。可见别名优先，别名为空时才读 details；不显示加密数据、签名或 redacted thinking。
- `content` 数组中 `thought: true`，以及 `thinking` / `thought` / `reasoning` 类型块。只有正文进入前台聊天气泡和流式正文预览。Worker 共用的旧通知清洗尚未改动。这里仅兼容被渠道放进 Chat Completions 的内容块，未新增 Gemini 原生 generateContent / Interactions 传输接口。
- 正文内明确的 `<think>` / `<thinking>` / `<thought>` 块，允许标签属性和闭合空格。全部完整块及末尾未闭合块均提取；未闭合部分不进入正文。

非流式响应统一成字符串正文及 `reasoning_content`，保留独立的 `anthropic_content`、`anthropic_thinking` 和 `reasoning_details` 字段；Anthropic 原生工具续答仍使用原转换器保存的签名块。SSE 可见摘要按增量拼接，不把加密签名解释为文字。

`extractContent` 不再用思考代替空正文。前台不会用思考兜底覆盖明确为空的回答；Worker 侧暂未更新本修复。云端心象仍只回传最终回复轮，且只挂第一条推送，长内容沿用旁路存储。

## 用户侧边界

关闭心象控制新卡片的显示及相关请求提示，不保证关闭模型推理、减少用量或让回复完全不变。Gemini 官方说明有些模型不能关闭推理，返回的可见内容可能只是摘要；摘要短或缺失不等于客户端漏捕获。

如果渠道把分析文字作为没有标记的普通正文返回，客户端无法可靠判断哪些应隐藏。截图只能证明显示异常，不能据此判定「假思考」、模型故障或渠道修改提示词。排查时核对同一轮响应字段和流式状态，不要求用户清空历史，也不收集 Key 或私人聊天内容。

个人版当前仅同步前台，**不替换已有 `worker/amsg` 源码、bundle、版本号或线上部署**，以保护 `2026-11-16.1` CORS、调度及数据。APP_VERSION 不变；云端结构化 thinking 改善尚待独立适配。

## 依据与验证

- [Gemini OpenAI 兼容接口](https://aistudio.google.com/docs/openai)：thinking 参数及 include_thoughts。
- [Gemini thinking](https://aistudio.google.com/docs/thinking)：可见摘要与不可读签名的区别。
- [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)：结构化摘要与流式增量。

前台专项回归覆盖普通 JSON、带回调和不带回调的 SSE、镜像去重、空白增量、结构化 thought 块、闭合后仍有未闭合块、关闭显示、普通英文保留、角色 `<心声>` 隔离和空正文。既有 Worker 回归只用于确认未破坏原云端行为，**不代表新版结构化 thinking 已在云端生效**。均为协议样本和模拟请求，未使用用户渠道 Key 实测。
