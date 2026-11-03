# 糯米海绵 · 独立部署分支

本分支仅部署 nuomi-haimian，禁止合并到糯米机网页分支。当前是只读额度/音色探针，海绵接口尚待实际验证。

Cloudflare: 现有 nuomi-haimian → Settings → Builds → Connect → 选择本仓库及 deploy/haimian-probe 分支；根目录留空；Build command: node --test worker.test.mjs；Deploy command: npx wrangler@4 deploy；关闭非生产分支部署。

连接 GitHub 后，向本分支推送新提交以触发首次构建；以 Cloudflare 构建日志及部署结果为准。

首次部署后，在 Worker Settings → Variables and Secrets 新增 Secret AUTH_TOKEN（至少32位随机字符串），值仅在 Cloudflare 私填。访问 Worker 首页即可临时填密钥和海绵 Cookie。Cookie 不提交 GitHub，不填全局代理。没有自动任务或付费操作。

本服务无数据库与定时器。独立 Worker 仍共享同账户请求额度。没有全账户硬限流，保密专用密钥，避免公开滥用。不会让助手自动取得 Cookie。

## 已有音色联调

`/` 保留只读探针；`/music` 为已有音色的独立生成联调页，尚未完成真实生成验证，也尚未接入糯米机前端。构建命令不变，worker.test.mjs 会加载 music.test.mjs。

在 `/music` 私填运行时密钥和 Cookie，读取积分与音色；输入用户指定的测试画布 ID 和歌词。准备会在该画布新增独立歌词、音乐节点及绑定，不删除已有节点、不覆盖布局。生成需用户明确点击，固定 batch_size=1，会消耗海绵积分。生成调用不自动重试；出现超时或错误需先到官网画布确认是否已经受理。保存生成任务 ID，可刷新页面后重新填入并手动查询。

进度查询追踪画布任务输出中的 song_task_id，再读取歌曲任务状态；完成后获取固定官方下载接口返回的音频链接。链接有有效期。没有后台轮询、定时器或数据库。创建新画布及自定义音色流程未接入；不会使用抓包里的个人画布或任务 ID 作为代码默认值。真实 HAR、Cookie、动态令牌不提交仓库。
