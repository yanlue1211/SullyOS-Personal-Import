# Gemini 原生与自动缓存

设置 → API 接口、角色独立 API、API 预设及后台独立 API 可选择「Gemini 原生（自动缓存）」。填写服务商根地址、`/v1` 或 `/v1beta`、Key 和模型名称，保存时统一为 `/v1beta/models`。中转须实现 Google generateContent、streamGenerateContent、模型列表及浏览器 CORS；不要仅凭模型名称自动切换协议。原有 OpenAI / Anthropic 配置不迁移、不改变。

## 请求与上下文

`utils/geminiApi.ts` 在现有 `fetchLlm` 出口适配。最终请求为 `/v1beta/models/<编码后的模型名称>:generateContent`，流式使用 `:streamGenerateContent?alt=sse`，鉴权为 `x-goog-api-key`。不新建代理或后端，不自动换供应商，不失败重发。

只将开头的 system/developer 转为 `systemInstruction`。历史中的系统记录、本轮召回、时间、歌曲和其他尾段保持原位置，转为带边界的上下文注释。不搬动世界书、角色设定或功能规则，不改记忆提取、归档和召回核心逻辑。

支持普通文本、base64 图片、HTTP 图片（无 API 鉴权下载后转 inlineData）、JSON 输出、函数工具及工具结果。图片下载须通过 CORS 并返回图片 MIME，超过 20 MB 报错。工具响应保留完整 native parts / thoughtSignature；本地和真实 amsg SDK 续答都传回这些字段，不能只传可见文字和工具名。思考展示开启时，2.5 使用预算，3+ 使用思考等级；未开启不主动增加思考请求。

SSE 按 UTF-8 增量解析，保留文字、思考、函数调用及签名；处理最终用量后才完成。缺少 finishReason、流内错误或取消均向上传递，不把半截响应记为成功。

## 缓存与统计

Argon 使用服务端自动缓存，不发送 Anthropic cache_control，也没有客户端 TTL 或缓存对象管理。相同内容靠前、变化内容靠后的现有结构继续保留；命中受上游路由、内容一致性及有效期影响，不保证命中率。

普通 Gemini 返回 `usageMetadata.cachedContentTokenCount`。本次授权中转的部分原生响应外层写 0，实际计费值却位于 `usageMetadata.billing_usage.openai_usage.prompt_tokens_details.cached_tokens`（`source=oai_chat`）。适配器按明确的 source 优先读取对应计费数据；原始字段保留，输入和缓存不重复相加。Gemini 原生 completion 计入 candidates 与 thoughts，total 使用服务端原值。

2026-11-05 对用户授权渠道的合成测试观察到：自营渠道原生端点一轮输入 32,786、输出 84、缓存读 30,727，站点账单确认缓存及实际扣费。另一个“不补”渠道暂未观察到命中。短输出 OK 的早期探针只用于验证请求和前缀复用，不代表正常聊天。换成长上下文和自然对话后仍需实测，不能推广为所有 Gemini 渠道的保证。

通过本次实际适配器补测正常中文聊天：非流式输入 32,850、输出 102、缓存读 30,737；追加对话并更新尾段后，流式输入 32,974、输出 72、缓存读 30,737。另有较短的 10,240 / 10,378 输入两轮未命中，说明命中不保证。流式函数调用及返回虚构结果后的非流式续答均完成。浏览器原生请求 OPTIONS 返回 204，允许站点 Origin、content-type 和 x-goog-api-key。

## 主动消息 2.0

复用现有无状态 Worker fetch 适配器，凭据仍使用加密的 URL / Key / Model 三字段，URL 表达原生协议。`/config-check` 新增 `geminiNative: true`。前台在写入原生云端任务或凭据前确认当前 Worker URL 的能力；旧 Worker 重新探测后仍不支持时明确报错，不能发向不支持的后台。

本次 Worker bundle 版本为 `2026-11-05.3`，使用云端即时对话的设备也要更新自己的 Worker。站点打包携带新 Worker 成品；前台功能不依赖额外服务。

## 验证

`utils/geminiApi.test.ts` 验证提示词顺序、原始数据不变、两种计费包裹、图片鉴权隔离、工具签名、任意 UTF-8 分片、取消、提前断流及真实 amsg SDK 工具续答。角色面板测试验证选择、测试连接和草稿保存；原有 Anthropic、预设和云端测试一并回归。

官方参考：[缓存](https://ai.google.dev/gemini-api/docs/caching)、[生成接口](https://ai.google.dev/api/generate-content)、[函数调用](https://ai.google.dev/gemini-api/docs/function-calling)。

## 2026-11-10 动态回放与兼容接口修复

ChatApp 实时尾段新增内部来源标记 `sully_live_context`。仅 OpenAI 兼容接口、模型名包含 Gemini、且携带该标记的请求，在网络出口把历史之后的 system/developer 原位包装为 `<system-reminder>` user 注释，并在稳定前缀解释用途。前置系统设定、工具定义、历史顺序、图片、工具调用/回执及每轮召回保持不变；不改变协议、凭据或召回算法。未标记路径（含 Lite）、其他模型、Gemini 原生及 Anthropic 原生沿用原逻辑。未知系统内容块保守直通。

部分兼容层收集所有 system 到 systemInstruction，会把每轮变化的时间、召回、歌曲和排程插到历史前。原位注释避免这种前移，使历史也可复用。适配同步打入主动消息 Worker；云端即时聊天需更新到 `2026-11-10.1` bundle 才生效。

私有备份回放使用实际归档水位后的 269 条记录，逐轮追加双边对话，并轮换备份记忆条目作为召回快照、已存歌曲客观分析及任务现状。经真实构造器及传输形状测试，兼容渠道旧形状一次观察到 24,067 / 38,225（63.0%），修复形状连续两次正常完成为 35,221 / 38,419（91.7%）和 35,221 / 38,349（91.8%）。这是样本缓存 token 占比，不是请求命中率或节费保证。测试有预热、路由和请求差异，不是严格成本基准。

同一兼容预设返回过不同 model 字段，部分缺缓存统计，须记为未知；原生“不补”渠道在动态与完全相同请求对照中均返回零，前端修复不能保证该上游提供缓存。快照代替实时向量搜索，天气和新闻联网关闭，不代表手机后台或云端已实际验收。私有备份、请求正文、密钥及模型回复不得提交。

`utils/geminiCompatibleContext.test.ts` 覆盖动态前缀、来源门禁、其他模型与 Lite 不变、图片、工具续答、Request 克隆及鉴权保持。
