# Anthropic 原生 Messages 与 Prompt Caching

设置 → API 接口，以及角色独立 API 均可选择「Anthropic 原生」。填官方根地址 `https://api.anthropic.com` 或完整 `/v1/messages` 地址、Key 和模型后保存。预设保存接口类型；切回旧 OpenAI 预设会清除原生模式。只根据域名不会自动切换接口。

## 请求边界

- `utils/llmEndpoint.ts` 把原生配置保存为明确的 `/messages` 端点；根地址补 `/v1/messages`，已有路径作为 API 前缀保留。第三方服务须自行支持 Messages 协议和浏览器 CORS。
- `utils/anthropicApi.ts` 在实际网络出口转换。兼容项目原有 `/messages/chat/completions`、`/messages/models` 拼接方式，真正发送 `/messages`、`/models`。OpenAI 和非模型请求不改变。
- `safeApi`、OSContext 裸 fetch 出口、设置页连接测试与模型列表共用转换器，安装标记避免重复转换。
- 使用 `x-api-key` 和 `anthropic-version: 2023-06-01`。仅浏览器增加 `anthropic-dangerous-direct-browser-access: true`；不新建代理，也没有失败后自动换供应商的路径。
- 支持文本、图片、函数工具、多轮工具结果、JSON 输出意图、thinking 签名、普通 JSON 及 SSE。原生模型名保持用户输入，不增加兼容接口专用的 `-thinking` 后缀。未知内容块明确报错。
- 当前支持 adaptive thinking 的 Claude 模型把旧的 `enabled/budget_tokens` 转为 `adaptive` 并映射 effort，旧模型保留手动预算。带工具的续答保留原生内容块顺序与完整签名，不能只复制可见正文和 tool_calls。
- SSE 按 UTF-8 分片解析，保留文本与工具参数增量；`message_stop` 才确认完成，连接提前断开和流内错误向上抛出，取消传到上游。模型请求不因网络失败自动重发。

## 缓存与用量

默认使用 5 分钟 `cache_control: {type: "ephemeral"}`（可选 1h），最多四个断点。优先保留完整角色 system、最近稳定历史及较早历史断点，余位用于工具定义；不再为跨角色共享世界书/功能规则占用断点。动态状态之后不再建立稳定历史断点。

ChatApp 恢复作者顺序：角色核心上下文（按条目位置排列的世界书、人设、用户资料、印象和记忆）→ 聊天补充及功能协议 → 历史 → 本轮动态召回/实时状态及原有末尾回应原则。全局世界书仍统一挂载，只取消为跨角色缓存抽出、排序和前移；条件触发、概率、深度、角色绑定及内容保持原管线。非拟人化模式继续按原开关省略角色扮演内容，不因此增加人设。

历史管线输出的 system/developer 记录（朋友圈、哔哔记录、深度世界书等）在请求构建处标记 `name: "sully_history_context"`，转换器据此允许缓存继续覆盖后续历史。未知 system/developer 仍按动态提醒处理，首次出现后不再收集候选，也不会因后续出现历史标记而重新开放缓存。这避免把每轮召回、排程快照及工具续答误写入稳定前缀。不匹配或解析正文来猜历史来源。

中途 system/developer 仍在原位置转为 `<system-reminder>` 上下文块，并在稳定 system 中说明其用途；原文不清洗，不改变消息时序。内部 name 不进入 Anthropic 最终载荷。

缓存是否命中由模型、最短前缀长度、内容一致性和有效期共同决定；短提示词不会因此保证省钱。首次写入与后续缓存读取的计费不同。设置 → API 调用记录展示返回的缓存读取／写入 token；输入总量包含普通输入、缓存读取和写入，不漏算。

## 主动消息 2.0

`worker/amsg/src/index.ts` 在模块初始化时安装无状态 fetch 转换器，覆盖 amsg SDK 内部调用及其他 Worker 模型请求。配置和凭据不存于全局变量；所有转换仅依赖本次请求。

`llm_credentials` 继续使用既有加密三字段 `apiUrl / apiKey / primaryModel`，原生协议由完整 `/messages` URL 表达。无数据库迁移，无新增明文凭据字段，工具续答保留 Anthropic 签名。

发布并同步新版 Worker 成品包后，已配置自动更新的用户打开新版 App 即会后台更新，成功后自动复查能力，无需手动重新连接。若部署完成晚于启动探测，首次原生请求会限时复查旧的不支持结果；确认支持后不再逐次预检。只有自动更新未配置、失败或网络异常持续存在时，才需要检查设置、手动更新等兜底操作。

`/config-check` 返回 `anthropicMessages: true`；前台把能力结果绑定到探测过的 Worker 地址，仍未确认支持时阻止提交原生云端任务或凭据。OpenAI 任务不受此门槛影响。后端 bundle 版本为 `2026-10-29`，应用 APP_VERSION 不变。

## 验证

- 协议测试覆盖图片、工具结果、普通／流式响应、UTF-8 任意分片、签名、错误、截断、缓存计数和真实 amsg SDK 两轮工具调用。
- Worker 模拟使用真实 D1/SQLite、加密任务、定时触发、即时对话与 Web Push，替换的只有模型响应等外部网络。
- 角色 API 面板的 jsdom 测试验证切换原生、测试连接、确认保存，不覆盖全局配置。
- 2026-10-29 对官方 `/v1/messages` 做不带 Key 的 OPTIONS 预检，返回 200，允许 Origin 与四个所需请求头。没有真实 Key，因此未验证某个账户的生成、账单或实际缓存命中率。

官方资料：[TypeScript SDK 浏览器选项](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)、[Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)、[Messages 流式事件](https://platform.claude.com/docs/en/build-with-claude/streaming)。

思考参数依据：[官方 Extended thinking 迁移说明](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)。4.7 及后续模型拒绝旧手动预算；4.6 建议改用 adaptive，4.5 及更早模型不能直接改用 adaptive。

## 2026-11-04 实测计数兼容

本次授权中转的实际响应有两种口径：原生形态的 `input_tokens` 不含缓存；含 `claude_cache_creation_5_m_tokens` / `claude_cache_creation_1_h_tokens` 字段的转换形态已经把缓存计入 `input_tokens`。转换器按该显式字段识别此已观测口径，不按大小猜测；原响应字段保留，统一的 `prompt_tokens` 只计算一次缓存。未知渠道仍沿用原生协议口径。

账单对照：37,329 总输入、64 输出，无缓存 $0.150596；普通输入 7,177、缓存读取 30,152、64 输出 $0.042048。27,967 总输入（已包含 21,091 缓存读取）、64 输出 $0.037220。上述金额为用户提供的本渠道账单，不是通用价格承诺。


## 2026-11-04 历史缓存边界修正验证

用户授权中转的合成文本测试（不是私人聊天）中，同角色后续请求总输入 13,094 token、读取 12,801；新测试角色总输入 13,090、共享读取 5,697、写入 7,097、普通输入 296。说明该渠道可同时复用个人历史与跨角色公共前缀；首次跨角色测试曾未命中，热身后再次交叉测试才观察到共享读取，命中仍受上游缓存隔离和路由影响，不承诺固定百分比。

对用户提供的 252 条消息请求做本地转换回放，仅增加历史来源标记，除 `cache_control` 外的模型可见载荷完全一致。历史部分最后断点的覆盖由 481 字符增至 31,980 字符，未覆盖对话尾段从 46,596 字符减至 15,097 字符（均非 token）；不删除记忆、聊天或功能规则。回归覆盖历史 system 记录、深度世界书、动态召回与工具续答边界、公共规则差异和四断点上限。

## 2026-11-05 单角色优先

不再通过公共前缀重排角色内容。世界书恢复每个条目自己的 slot/order；用户基础资料回到角色核心中的用户画像位置。时间、召回、情绪、日程、音乐等仍在历史后的动态块；格式提示仍在固定层，末尾保留作者回应原则。单角色缓存取决于前缀一致性、渠道路由及 TTL，结构测试不代表实际付费请求必然命中。
