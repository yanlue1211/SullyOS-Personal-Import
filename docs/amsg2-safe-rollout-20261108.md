# 预约消息 / 离开后消息：生产环境安全发布单（2026-11-08）

> **状态：待生产环境只读核验，未获真实 Worker 发布成功证据。** 本文档仅适用于个人仓库 `yanlue1211/SullyOS-Personal-Import`，不代表 PR 已上线。禁止用此清空云端任务/D1、重建 Worker、生成新 Master Key、替换 VAPID 或泄露任何 token。

## 一、发布版本和绝对红线

- 生产网页发布分支：`personal/audio-listening`；发布前记录最新成功的 Pages commit，不以默认/master 代替。
- 开发合并来源：PR #80，`personal/amsg2-away-bootstrap-repair-20261108`。**合并前重新读最新 PR head / base，确认没有其他窗口写入新成果。**
- 拟部署 Worker 版本：`2026-11-08.10`（`utils/amsgBundleVersion.ts` 和已构建的 `worker/amsg/worker.bundle.js`）。自动测试成功不代表云端已经运行这版。
- 原 Worker：`sullyos-amsg.yanlue.workers.dev`；必须原位升级已有脚本，保留已有 `DB` D1、`INSTANT_TICK`、Master Key、VAPID、推送订阅、Cron、租约及已排任务。**不执行一键重新部署，不点击任何重置库/清除任务/重置密钥操作。**
- `worker/amsg/wrangler.toml` 的 `database_id` 为 `REPLACE_WITH_YOUR_D1_ID`，**不可直接拿它执行 wrangler deploy**；重新部署也可能覆盖绑定、迁移标签与触发器，必须先核对实际生产绑定。
- Worker 取包 URL 不得指向作者仓库或无关旧仓库，否则自动更新可能把个人版 Worker 覆盖回不兼容代码。

## 二、可安全进行的上线前只读核验

1. 查看正式网页 Pages 最近成功部署 commit，确认仍是发布分支、与 PR base 的差异、其他窗口是否有新提交；若不同先停止融合，保护所有个人改动。
2. 用浏览器打开 **现有** Worker `/config-check`（只读）：记录 `workerVersion`、`schemaVersion`（如果提供）、`instantTick`、`selfUpdate.supported`、绑定检查及警告。不要将任何真实密钥粘到聊天或提交中。
3. 用 Worker 现有 `/debug`（只读）或 Cloudflare 面板，核对 D1 绑定标识、Cron 每分钟触发、最近 tick、推送配置、Durable Object 是否完整，以及当前待发任务数量。核对已有预约/离开后任务，不删除/覆盖。
4. 在 Cloudflare 面板的 **现有 Worker** 上确认 `AMSG_BUNDLE_URL` 是否已设置，以及其实际来源。如果不是个人仓库，此项必须先纠正、并同步检查 Worker 自更新开关；**不能让旧 Worker 自行从别处拉包**。
5. 检查原有密钥、D1 绑定、触发器与推送仍存在即可；不导出任何私密值，不生成新密钥。如果缺关键信息或没有管理权限，停止写操作，先留用旧版。

### 已实际取得的生产只读证据（2026-11-08）

通过 GitHub Actions 的单次匿名 **GET /config-check**（workflow `42481121249`，job `128733052404`）拿到真实响应，只有白名单状态字段，没有上传聊天、密钥或用户资料：

- 生产 Worker **当前版本为 `2026-11-08.3`**，**不是** PR 需要的 `2026-11-08.10`；所以 PR **不能据此宣布上线**。
- `configurationOk=true`、`missing=[]`、`warningCodes=[]`，表示该公开自检报告配置无缺项（不等于确认 D1 身份或推送实际送达）。
- `instantTick=true`、`backgroundJobs=true`、`selfUpdateSupported=true`。这只能说明自更新能力存在，**不能证明更新取包 URL 指向个人仓库，也不能代替原位升级权限核验**。

连接器仅能操作 GitHub，不能读取 Cloudflare 账户中的 `AMSG_BUNDLE_URL`、D1 真实绑定 ID、Secret 绑定值或生产任务清单。因此第 3—5 步仍需要在原有 Cloudflare 面板只读核对；**没有核验取包来源之前不触发自更新**。

## 三、最小风险的配套发布顺序

1. 先确认版本和真实 Worker 原位升级能力；只读检查、备份及回退方案准备完成后才进入写操作。必要时先将旧 Worker 的部署脚本版本与生产配置留存为回退证据。
2. 若已有 Worker 具有经过验证的 `/self-update` 能力，且 `CF_API_TOKEN`、`AMSG_SERVER_TOKEN` 均在 **现有实例** 中正常：选择一个经过 CI 验证且不可变的 PR commit 源 URL 作为过渡取包来源，例如
   `https://raw.githubusercontent.com/yanlue1211/SullyOS-Personal-Import/<PR完整HEAD-SHA>/worker/amsg/worker.bundle.js`。
   这一步需要核实 Cloudflare `AMSG_BUNDLE_URL` 实际值和当前自更新权限；更改后有可能被定时自动更新提前触发，需在明确的发布窗口进行。无此能力或不确定，**不能尝试盲目自动覆盖**。
3. 原位更新 **现有 Worker** 后，再读取其 `/config-check`，核实运行中确为 `2026-11-08.10`，且 `DB`、Cron、Push、`INSTANT_TICK` 及旧任务无损。只看更新接口报告成功不算完成。
4. 然后才能将 PR #80 合并到网页真正的发布分支，等待 Pages 正式部署成功，并从手机核实发布版本。旧网页与新版 Worker 的中间阶段要特别注意仍在进行中的预约。
5. 发布分支包含已验证 bundle 后，再将 `AMSG_BUNDLE_URL` 切换/核对为个人 **正式发布分支** 上的 bundle URL（不能永久锁在开发 SHA，避免以后自动更新被钉死）。验证不会自动回退到原作者或其他仓库。
6. 不对现有 D1 做重建/清库/危险迁移；若升级失败，保留当前绑定与所有任务，停止继续写操作，先定位；不能简单回退旧 Worker 代码而忽视新旧数据格式兼容性。

## 四、真机最低验收（不做无意义付费测试）

- 角色 A 开启离开后消息但关闭预约消息：应独立建立云端下一次联系机会。角色 B 反向设置：预约仍能正常执行。
- 正常聊天后离开后任务从**最新**真实用户互动时间重新计时；快速连发不产生两条重复链。切回前台遇到正常未来任务时不改期。
- 修改离开间隔/关闭功能（特别是在任务创建中）：旧链无残留，预约清单及未来预约不变；再次保存关闭设置允许清理残留。
- 睡眠禁发、线下见面、通话期间：**只拦离开后任务**，不扣预约额度，也不烧被禁发的模型请求。
- Worker 到点成功续排下一节拍，锁屏消息投递与客户端收件箱、去重、归档一致；旧任务保持，不能仅凭 UI 读不到就判断 Worker/Char 没工作。
- 「最近 12 次联系机会」能区分 entered、deferred、silent、skipped、failed、queued；queued 仅表示已进入推送/收件箱，**不是手机已收**。
- 使用用户明确配置的低成本独立 API 做必要的最少真实生成；配置不完整时应明确失败，不能偷偷调用昂贵主模型。注意 Worker/API/D1/推送各自指标。

## 五、验收结论的措辞

- CI 成功：`代码编译、模拟 Worker/D1/推送和回归测试通过`。
- Worker 生产版本已核验：须有实时 `/config-check` 和面板证据。
- 网页已部署：须有 Pages 成功部署及手机实际版本证据。
- 完整验收：必须经过真机真实任务、Cron、通知、收件/去重验证。

任何一项未拿到证据，就继续标为「待验证」，不得说「已经上线／全部成功」。
