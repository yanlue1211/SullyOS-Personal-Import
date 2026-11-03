# 糯米海绵 · 独立部署分支

本分支仅部署 nuomi-haimian，禁止合并到糯米机网页分支。当前是只读额度/音色探针，海绵接口尚待实际验证。

Cloudflare: 现有 nuomi-haimian → Settings → Builds → Connect → 选择本仓库及 deploy/haimian-probe 分支；根目录留空；Build command: node --test worker.test.mjs；Deploy command: npx wrangler@4 deploy；关闭非生产分支部署。

首次部署后，在 Worker Settings → Variables and Secrets 新增 Secret AUTH_TOKEN（至少32位随机字符串），值仅在 Cloudflare 私填。访问 Worker 首页即可临时填密钥和海绵 Cookie。Cookie 不提交 GitHub，不填全局代理。没有自动任务或付费操作。

本服务无数据库与定时器。独立 Worker 仍共享同账户请求额度。没有全账户硬限流，保密专用密钥，避免公开滥用。不会让助手自动取得 Cookie。
