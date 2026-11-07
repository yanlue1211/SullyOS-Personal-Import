# 🐾 SullyOS 主动消息 2.0 / 原作者更新交接（2026-11-08 03:05 北京时间）

> 供下一个 ChatGPT 开发窗口直接阅读。**这是已合并的网页个人版继续开发分支，不是尚未发布的 PR #75 测试分支。**
> 此文件只记录交接信息；不涉及 Cloudflare 操作，也不记录任何用户凭据。

## 0. 仓库与接手入口

- 原作者：`qegj567-cloud/SullyOS`
- 个人仓库：`yanlue1211/SullyOS-Personal-Import`
- 实际个人网页发布分支：`personal/audio-listening`，截至交接 HEAD：`4e740faeb8f24cbe2fde0ff9c7881ddd5217af49`。
- **本次新建接力开发分支：`personal/amsg2-worker-acceptance-20261108`**，从上述已合并的正式网页个人版出发。后续功能开发应在这个分支继续，重新检查上游和其他窗口提交。
- GitHub 默认分支 `TIAO-Capacitor`、旧 `master`、`dev` 不是可直接覆盖个人网页的发布基线；APK/Worker/网页必须分别核验实际版本。
- `PR #76` 已于 2026-11-08 02:58 北京时间合并至 `personal/audio-listening`（merge `4e740fae`）；`PR #75` 旧 master 基线草稿已关闭、未合并。
- GitHub Pages Actions `42403899111`：**success**；`Audio listening branch build` `42403898851`：**success**；PR #76 的专项集成检查 `42403628815`：**success**。不要把 Actions success 当成真实 Cloudflare 验收。
- 前端期望的 Worker bundle `AMSG_BUNDLE_VERSION = 2026-11-08.3`，定义在 `utils/amsgBundleVersion.ts`。前端和代码仓库已更新，不意味着用户真实 Cloudflare 上的 Worker 已更新。
- 单用户 Worker 名称通常为 `sullyos-amsg`；实际用户 Cloudflare 账户/脚本名/Worker 地址必须再核对。

## 1. 这轮已经完成的事项（代码、自动测试、网页部署）

1. 保留当前完整个人版为基线，把 PR #75 所写主动消息 2.0 B 方案和原作者相关更新重新融合，不采用旧 master 整文件覆盖。
2. 融合主动消息 2.0 与「离开后消息」两个独立开关的四种组合：
   - 只开 2.0：Char 自主预约未来线上消息，不启动空闲循环。
   - 两个都开：自主预约 + 周期性空闲联系机会；Char 可决定静默；禁发时段空闲节拍跳过，不补发；见面/通话保护。
   - 只开离开后消息：沿用作者本地离开后逻辑；页面重新打开后按原规则最多补发三次，不依赖 2.0。
   - 都关：都不运行。
3. B 方案循环：按设置间隔给 Char 一次是否线上联系机会；静默不停止续排；休眠时间不调用模型也不补发过期节拍；确定性 UUID、节拍账本、租约、云端对账与 Worker 失败恢复机制已实现。
4. 线下见面：不因锁屏、切后台、过夜自动结束；空闲提醒被保护。仅当用户主动结束、同一 Char 首条正常线上消息成功保存、或本次见面期间预约的**实际线上消息成功发送**时，结束该次见面。预约未发送不结束，旧预约不能结束新的见面。预约提示词明确是未来线上发送，不是线下当面台词。
5. 主动消息独立 API：空闲自动消息和 2.0 到点生成可使用独立 API；普通聊天和即时聊天中的预约工具仍使用正常对话 API；不同 Char 凭据隔离；兼容 Anthropic 原生和 OpenAI 兼容；显式启用独立 API 却未填全配置时必须失败关闭，禁止偷偷回退昂贵主模型。
6. Worker：任务续排/抢占/失败控制、旧 D1/旧 Master Key 保护、版本不匹配禁止创建新 B 循环任务、静默不重复计费的防护均已写入并通过模拟/单测。固定 UUID 不等于外部 LLM 调用绝对只会发生一次。
7. 安全融合现有个人定制：聊天、相册 Char 自主保存、已总结隐藏媒体清理及共享引用、月栖、造物间、写歌、音乐识别、语音和通话、心声、世界书、记忆与缓存、桌宠等核心功能保留。**不是宣称手机所有交互已真机验收**。
8. `PR #76` 合并前 CI 已通过：锁文件检查、个人聊天/媒体/相册/音频/记忆上下文回归、Worker bundle/源码一致性、HTTP/SQLite/模拟模型和推送集成测试。GitHub Pages 部署成功。
9. 已将 Worker 默认更新来源改成与个人版发布分支相对应的安全路径，并在旧 Worker 版本不一致时设置保护；仍需核验**用户实际部署的 Worker**和更新来源，不能拿默认值替代线上事实。

## 2. 尚未完成 / 不能误称完成

- **真实 Cloudflare Worker 尚未确认升级到 `2026-11-08.3`；真实 Cloudflare B 方案验收尚未完成。**
- 真实云端 D1 表、旧任务与用户 Master Key 不应擅自迁移、清库、重装或更换密钥。
- 未证实真实 Push、后台/锁屏/完全关闭前端、跨午夜、旧任务恢复的完整效果。
- 未验证付费服务商侧实际请求次数、模型路由、不同 Char 独立 API 费用与失败重试的精确计费。
- 不能证明 Worker 崩溃期间外部模型调用绝对不会重复扣费；应审查 leases/心跳/retry/ack 后用有限次数且便宜的真实测试。
- 原作者自 2026-11-05 08:55（北京时间）以来**非主动消息的更新还没有全部同步**；需要重新对照作者最新 master，不可根据老清单误判已经完成。
- 当前网页成功发布 `4e740fae` 不意味着 APK 同步。APK 版本必须单独查。
- 点点栖桌宠未完成修复的部分明确由独立桌宠窗口负责，此窗口不改。海绵音乐实验未完成，暂缓。
- 用户明确**不合并**中转 Gemini 缓存读取量统计修复（原 PR #71，已关闭未合并）；不要重新提出或重复开发。
- 用户暂不引入作者独立用户空间架构提交 `9687a881f9`。
- 已关闭的 PR 清理标签 Actions 报错不是主体 PR 测试失败，不要将其误报为发布失败。

## 3. 下一窗口优先任务（严格按顺序）

### A. 重新核对线上版本与旧云端数据（只读优先）
1. 用 GitHub 检查本接力分支/发布分支/最近 Actions/其他窗口新提交，核对部署提交、Worker 源码及 bundle 版本。
2. 核实 Cloudflare 用户现有 Worker 地址、实际报出的 `GET /config-check` `workerVersion`、能力位、已有计划、旧 Master Key 与 D1 是否完整。如果没有 CF 接口访问权限，就明确指出无法直接验证，不能猜测线上成功。
3. 对照 `utils/activeMsgClient.ts` 的 `probeWorkerVersion`、`selfUpdateWorker`，`utils/cfProvision.ts`、`worker/amsg/src/index.ts`、`worker/amsg/wrangler.toml` 的安全升级流程。**绝不走“全新部署/清空数据库”来替代旧 Worker 升级**。
4. 若真要部署：保留现有 D1、密钥、服务绑定、Cron、Durable Object、Workers Logs、`global_fetch_strictly_public` 等配置；核验更新源确为个人版，确认新旧 Worker 正常对接，并检查旧排程没有被损坏。

### B. 真实验收关键场景
- 正常离线：20:00 最后聊天，2h 空闲间隔，02:00–06:00 禁发，Char 另有 05:30 线上预约。22:00/00:00 可给 Char 一次机会；02:00/04:00 无调用；05:30 独立预约正常执行；06:00 恢复空闲节拍；禁发期间不补发。
- 线下见面过夜：空闲提醒屏蔽，但线上自主预约可执行；成功线上发送后结束对应这次见面，用户首次正常线上发言也结束；旧预约不影响新见面。
- 四种开关组合 + 关闭开关时是否停止对应云端循环；跨角色互不干扰；用户正常聊天/通话不被主动任务打断。
- 后台/彻底关闭前端/系统清理后台/跨午夜/Push/消息入库与恢复对账。
- 独立 API 的配置保存、不同 Char 隔离、Anthropic 与 OpenAI 兼容、切换配置后存量任务刷新、无效配置不回退、重复模型请求风险及小额实际费用。
- 旧 1.0 先保留，等真实 2.0 稳定再清理。测试与真实部署状态严格分开汇报。

### C. 主动消息完成后，继续作者其他更新
重新比较作者 master 与实际个人版；已知待核对/融合项包括：页面加载卡顿及缓存恢复、SAR 修复、缺失素材的备份容错、Chibi PNG 导出分享、合照姿势/重拍、彼方 Bibi、使用统计、GitHub Pages 重试与其他稳定性修复。
备份缺失素材修复是“引用指向不存在的原文件时做异常报告与容错”，**不是媒体清理**；融合时保护 Char 自主保存相册、已总结隐藏媒体清理及共享引用。只整合作者安全独立部分，不引入明确拒绝的独立用户空间。

## 4. 长期原则
保护数据与原作者记忆体系 > 尊重原生架构并持续吸收作者更新 > 保留所有个人功能 > 认准真实部署版本 > 稳定兼容 > 创新。GitHub 常规读取、修改、提交、测试、正常部署已授权；重大数据损坏/高费用/破坏其他窗口成果必须先确认。不得误把自动测试当成真实上线验收。

## 5. 2026-11-08 接力窗口第一轮核查（只读预检，未进行 Cloudflare 部署）

- GitHub 核对：正式网页分支 `personal/audio-listening` 仍为 `4e740faeb8f24cbe2fde0ff9c7881ddd5217af49`，与交接的基线一致；接力分支比正式分支只多此交接文档（后续若有提交须重新比较）。
- GitHub Actions 回执已重新读取：Pages `42403899111`、个人版构建 `42403898851`、主动消息专项集成检查 `42403628815` 均为 `success`。这只证明 CI/网页发布，不代表 Cloudflare Worker 已升级。
- 代码/产物已检查：`utils/amsgBundleVersion.ts` 期望 `2026-11-08.3`；发布分支的 `worker/amsg/worker.bundle.js` 已存在且含该版本标记（blob SHA `6c2fe0a20002feb2f358a6c25fd986b2d5e40eee`）。这只证明仓库有对应包。
- 新源码 `worker/amsg/src/selfUpdate.ts` 默认取包地址为 `https://raw.githubusercontent.com/yanlue1211/SullyOS-Personal-Import/personal/audio-listening/worker/amsg/worker.bundle.js`，但**旧 Worker 正在运行的自更新代码不一定已采用这个地址**。如果旧 Worker 的 `AMSG_BUNDLE_URL` 或固化默认来源仍指向作者/旧部署仓库，贸然点「更新 Worker」可能继续安装旧包。首次更新前务必核对旧实例的取包来源。
- `.github/workflows/deploy-cloudflare-worker.yml` 只对旧 `master` 部署静态站点，不是个人主动消息 Worker 的自动升级通道；`.github/workflows/sync-workers-repo.yml` 只监听 `main/master` 并推送到 `Tosd0/sullyos-workers`，也不会自动为本次个人网页分支发布主动消息 Worker。**不要以任何 GitHub Actions 成功代替真实 Worker 验收。**
- 尚无用户实际 Worker URL 或 Cloudflare 账号的可信确认，也没有可用的 Cloudflare 管理连接。尝试读取历史提及但未经用户确认的 workers.dev 地址未取得可验证回执；因此未确认线上 `GET /config-check` 的实际版本、环境、D1 和 Cron；**未调用 `/self-update`，未更换凭据、部署脚本或操作 D1。**
- 下一步仅需要真实 Worker 的非敏感地址（或 `/config-check` JSON，注意移除任何凭据），并核对 Cloudflare 现有脚本、实际旧版取包地址及绑定，再决定是否通过原位自更新或保留原绑定的人工升级。真实升级后需复查 `workerVersion`、`instantTick`、`backgroundJobs`、`selfUpdate`、D1、Cron 与实际低成本投递结果。旧数据和 Master Key 保持原样。

### 5.1 用户真机界面回执（2026-11-08 03:18，截图）

- 用户提供的真实 Worker URL：`https://sullyos-amsg.yanlue.workers.dev`（脚本名按 workers.dev 格式可推为 `sullyos-amsg`）。
- 用户主动消息设置 UI 显示：**Worker 实际自报 `2026-11-07.3`**；该 UI **前端期望 `2026-11-05.3`**，按钮竟然写「更新 Worker 到 2026-11-05.3」。**这是旧前端误提示，有降级风险，不能点**。
- 截图底部的实际运行构建：`personal/audio-listening@346fa29`，`sw 1.22.0`；查 GitHub `346fa29` 的 `utils/amsgBundleVersion.ts` 确实写 `2026-11-05.3`。正式已发布源码为 `4e740fae`（内置 `2026-11-08.3`），两者相差 22 个提交。请先区分 PWA/SW 缓存 vs 旧 APK/安装包，确认用户跑上新网页再操作版本更新。
- UI 自动更新栏显示「上次检查 2 小时前，没成功（`UNAUTHORIZED: 共享密钥对不上。`）」；该错误可能来自一次手动或前端触发的受保护更新请求，截图并不能证明服务端 Cron 自查的每次结果。**不要点「随机」重新生成共享密钥**，核对前端保存的 X-Client-Token 与 Worker 既有 `AMSG_SERVER_TOKEN` 是否一致；只修正不一致端，不更换 D1 主密钥。
- 由于当前执行环境无法访问 `workers.dev` 地址的公开 `/config-check`（网络/DNS 限制），以上事实仅据用户真实界面截图，仍需完整 JSON 的能力位和 CF 面板绑定核对。当前没有对真实 Worker 做任何写操作或升级。

- **新增重要风险（已核对 `346fa29` 源码）**：旧前端 `utils/amsgAutoUpdateTrigger.ts` 发现版本不相等就会在冷启动时直接调用 `POST /self-update`，**不区分升级/降级**；截图的旧前端期待 `2026-11-05.3`，当前后端却自报 `2026-11-07.3`。因此必须先让前端确实升级到正式版本 `4e740fae`，且核对旧 Worker 的取包来源，**之后**才处理 `AMSG_SERVER_TOKEN` 不匹配。不要先纠正 token 或点绿色「更新 Worker」按钮，以免解除安全拦截后触发旧前端覆盖当前 Worker。当前已合并前端 `utils/amsgAutoUpdateTrigger.ts` 遇到版本不一致会阻止自动覆盖，可作为基础。

### 5.2 用户刷新后及真实公开接口回执（2026-11-08 03:23，截图）

- 用户已刷新到 `personal/audio-listening@4e740fa`（对应正式源码 `4e740fae`），构建时间显示 2026-11-08 02:59:03 UTC+8；旧版前端危险提示已消失，新的设置页正确显示「更新 Worker 到 `2026-11-08.3`」。
- 用户通过浏览器打开真实 `https://sullyos-amsg.yanlue.workers.dev/config-check`，截到 JSON：`success:true`，`data.ok:true`，`missing:[]`，`warnings:[]`；`instantChat:true`、`instantTick:true`、`backgroundJobs:true`、`anthropicMessages:true`、`geminiNative:true`、`thirdPartyPush:true`；`workerVersion:"2026-11-07.3"`；`selfUpdate.supported:true`。
- 自更新状态 `lastSource:"manual"`、`lastOutcome:"failed"`、`lastError:{code:"UNAUTHORIZED",message:"共享密钥对不上。"}`。**这是一条历史失败状态，不代表已测试刷新后当前配置，也不能据此认定 Cron 自检请求失败。**
- 对照历史代码：旧前端提交 `346fa29` 的 `worker/amsg/src/selfUpdate.ts` 默认 `BUNDLE_URL` 明确指向 `https://raw.githubusercontent.com/Tosd0/sullyos-workers/main/amsg/worker.bundle.js`；当前个人源码才改为 `yanlue1211/SullyOS-Personal-Import/personal/audio-listening/worker/amsg/worker.bundle.js`。**旧 Worker 未必就是这个源，但如果没有显式 `AMSG_BUNDLE_URL`，可能拉取作者包，因此仍不可直接点更新。**
- 下一步 Cloudflare 只读核实：`sullyos-amsg` → Settings → Variables and Secrets 中是否存在 `AMSG_BUNDLE_URL`（若存在核对值，只分享非敏感来源地址），并核对 `AMSG_SERVER_TOKEN` 是否已有；千万不要展示任何密钥的实际值，不要点随机/清库/全新部署。确定实际更新源、安全处理共享密钥差异后再执行已有 Worker 的原位升级并逐项检查。

### 5.3 Cloudflare 更新来源已在生产环境增加（2026-11-08 03:31，用户截图）

- 用户通过 Cloudflare Dashboard → `sullyos-amsg` → Production → Runtime variables and secrets 添加公开 Text 变量 `AMSG_BUNDLE_URL`，目标为个人发布分支的 `worker/amsg/worker.bundle.js`；截图变量表新增了一行 `Variable`、并显示 `wrangler.jsonc / wrangler.toml` 的 `AMSG_BUNDLE_URL` 配置提示。截图不显示完整值，需在真实升级前复核来源字串。
- Cloudflare 提示 `Update your Wrangler configuration with these changes to keep deployments in sync`，这是配置同步提醒，非 Worker 更新失败。不应照提示随意更换构建配置或把任何 Secret 明文写入公开仓库。后续通过 Git/Wrangler 重部署须确保该变量仍保留（个人仓库 `worker/amsg/wrangler.toml` 有 `keep_vars = true`，但实际部署来源待核）。
- 这一轮操作只证明生产变量已添加，不证明 Worker bundle 已由 `2026-11-07.3` 升至 `2026-11-08.3`。下一步重新读取只读 `/config-check`，再核对 `CF_SCRIPT_NAME`/旧授权共享密钥及原有绑定。自动更新的 Cron 检查可能独立于前端共享密钥，不能把历史 `UNAUTHORIZED` 当作每轮 Cron 错误。

### 5.4 手机已通过「重新连接并验证」（2026-11-08 03:36，用户截图）

- 当前最新正式网页 `personal/audio-listening@4e740fa` 的主动消息设置弹出绿色成功提示「已连接成功，主动消息 2.0 可以用了」，说明 Worker 已通过 `POST /init-tenant`、用户密钥握手和前端的能力探测等连接流程。
- `utils/activeMsgClient.ts` 的 `fetchWithAuthRaw` 在 `config.serverToken` 非空时发送 `X-Client-Token`；因此此次成功是当前普通请求鉴权可用的强证据。之前 `selfUpdate.lastError = UNAUTHORIZED` 可能为旧历史状态，不应直接重置 `AMSG_SERVER_TOKEN`。
- **连接成功不能替代实际 `POST /self-update` 的鉴权/权限验证**，更不能代表 Worker 已升级到 `2026-11-08.3`。在用户已添加正确的生产 `AMSG_BUNDLE_URL` 且完整值核对无误前提下，可从最新前端触发一次原位升级；应保留原有 D1、Master Key、Push、Cron 和 DO，失败立即停止重试并查看错误，成功后再以真实 `GET /config-check` 确认版本及能力位。不能把此连接成功误报为 B 方案验收。

### 5.5 用户点击原位「更新 Worker」获得成功回执（2026-11-08 03:38，真机截图）

- 最新网页 `personal/audio-listening@4e740fa` 上，用户点击「更新 Worker 到 2026-11-08.3」后出现绿色 Toast **「已经更新到最新版本。」**，这是 `POST /self-update` 已报告成功的证据。
- 截图拍摄瞬间，两个按钮仍显示「处理中…」，而版本文案仍为旧 `2026-11-07.3`，因此不能从该图单独证明部署后端已开始以 `2026-11-08.3` 运行，可能是自动重新连接与能力探测尚未刷新 UI。
- 当前窗口无法通过公共网络直接请求 `https://sullyos-amsg.yanlue.workers.dev/config-check`（DNS/网络不可达）。下一步让用户通过浏览器**重新打开** `/config-check` 并提供真实回执，重点核查 `workerVersion=2026-11-08.3`、`ok=true`、`missing=[]`、`warnings=[]`、`instantTick=true`、`backgroundJobs=true`；之后再检查 D1 旧任务、Cron、真实 Push 与低成本离线行为。
- 无重新创建数据库/重新生成 Master Key 操作的用户报告；但实际绑定保留与排程完整性仍需独立验收。不要将更新按钮成功提示等同于全 B 方案通过。

### 5.6 真机确认 `2026-11-08.3` 已在生产 Worker 运行（2026-11-08 03:39，用户截图）

- 用户在手机浏览器访问真实 `https://sullyos-amsg.yanlue.workers.dev/config-check`，JSON 自报 `workerVersion: "2026-11-08.3"`，`success:true`、`ok:true`、`missing:[]`、`warnings:[]`，**真实 Cloudflare Worker 版本升级已确认**。
- 关键能力位：`instantChat:true`、`instantTick:true`、`backgroundJobs:true`、`anthropicMessages:true`、`geminiNative:true`、`thirdPartyPush:true`、`diagnosticReproduction:1`。
- `selfUpdate.supported:true`、`state.lastSource:"manual"`、`state.lastOutcome:"updated"`、`state.lastError:null`，`bundleHash:"de776f94f5c9"`，`lastUpdatedAt:"2026-11-07T19:38:24.501Z"`（北京时间 2026-11-08 03:38:24）。
- **结论**：真实生产 Worker 的升级及运行时配置/能力版本初验通过；但尚未检查旧任务数据完整性、Cron 实际心跳、Push 实际投递、离线循环、见面保护、费用与失败恢复，**不可把此结果宣称 B 方案完整验收**。
- 当前执行环境对 `workers.dev` 域名 DNS 解析失败，无法自行直连 `/debug`；下一步先让用户在手机浏览器读只读 `/debug`，核对 storage/schema/tick 与 Cron，后续再安排低费用且有限次数的真实业务验收，不清 D1、不重置任何密钥。

### 5.7 生产 `GET /debug` 只读体检通过（2026-11-08 03:41，用户真机截图）

用户浏览器访问 `https://sullyos-amsg.yanlue.workers.dev/debug` 获得 `success:true`，时间 `2026-11-07T19:41:38.033Z`：

- `config.ok:true`，`missing:[]`，`warnings:[]`。
- `storage.reachable:true`、`schemaReady:true`、`schemaError:null`、`missingTables:[]`、`missingColumns:[]`。
- 数据库 schema 为 `current:"3.2.0-lease-token"`、`required:"3.2.0-lease-token"`、`ok:true`、`missing:[]`；所以**当前 D1 表结构与新版 Worker 兼容**，不需要手动 SQL 或重建库。
- `storage.pushSubscriptionRegistered:true`，`pushDelivery.gone:null`。证明数据库登记着一条订阅且未发现最近的失效回执；**不能证明本手机推送 endpoint 与云端相同或 Push 实际抵达**。
- `storage.pendingTasks:0`、`overdueTasks:0`、`tick:"idle"`；这不是 Cron 已验证正常的证据。源码 `judgeTick` 在 `pendingTasks=0` 时直接报告 `idle`，所以**尚无待发任务可验证定时投递**；不代表旧数据丢失，零待发也不证明历史任务数量保留。
- `server:null` 源于 `readServerVersion` 无法读取上游 `/capabilities` 的回执，不影响 `config`、D1 schema 与 Worker 的能力位已通过的事实。
- `stuckTasks/retryingTasks/overdueVerdict:null` 因无过期任务，**不能把 null 算异常也不能宣称失败恢复已验收**。
- 下一步优先低费用真机端到端实验：用现有角色的主动消息 2.0 面板新建一个「固定」+「一次」的几分钟后到点消息（源码 `components/chat/ActiveMsg2SettingsModal.tsx` 的 `mode=fixed` 无 LLM 生成），等待时关网页/锁屏，核验通知与回到聊天后的入库；先查后台任务 Cron 是否显示启用。测试后核对新增的任务被消费、不会重复，再做 B 方案空闲循环与独立 API 的受限真实模型测试。
- 生产 Worker 版本升级与 D1 兼容性体检可判**通过**；完整 B 方案行为、Cron 实际执行、Push 送达、费用和恢复仍为**待验证**。不要以 `tick:"idle"` 冒充 Cron 成功。

### 5.8 真实云端固定消息首次锁屏投递成功（2026-11-08 03:50，用户手机通知截图）

- 03:46 左右用户按计划在丁程鑫角色侧安排固定测试消息。03:50 锁屏通知中心显示来自 **WxPusher** 的推送「来自 丁程鑫：「🐾 主动消息2.0云端测试成功。」」。
- 这是用户真机截图佐证的**固定消息离线云端触发 → 第三方推送抵达手机**端到端成功案例；固定模式无需 LLM 生成，验证过程不应消耗主动消息生成模型额度。
- 现有证据**不证明**聊天记录已经入库，也没有独立检查是否只投递一次、定时触发器后续稳定性、Char 自主预约/自动空闲循环/见面保护/独立 API/失败恢复。需用户重新打开对应 Char 聊天检查同一条消息是否出现、是否重复，并在任务列表或只读 `/debug` 核查无残留/过期任务。
- 后续如测试自主消息生成，必须限制频次和成本，不要把固定消息 Push 成功冒充完整 B 方案的真实验收。
