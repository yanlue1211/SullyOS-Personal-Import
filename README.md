# 糯米海绵 · 独立测试部署

仅部署 nuomi-haimian，禁止合并到糯米机网页分支。Cloudflare Builds 连接 deploy/haimian-probe，构建 node --test worker.test.mjs，部署 npx wrangler@4 deploy。运行时 AUTH_TOKEN Secret 至少 32 位。

/music：原创谱曲直连测试版 4。输入歌词、曲风、歌名和已有音色；固定 batch_size=1、biz_type=0、is_original_prompt=true；按官网成功抓包解析 tasks 数组并显示实际扣分和余额。完成必须 progress=100 且有成品 vid；下载使用 misc/download，无需发布或画布。生成不自动重试，结果不明先核对官网。保存任务 ID 可恢复查询。

音色创建测试：展开上传朗读音频，选择不超过 8MB 的角色日常 TTS 干声文件并填写完全对应的海绵指定台词；临时 VOD 授权→上传→提交→source=0 注册→查询状态。临时密钥仅留在请求中，不发送 Cookie 到上传存储，不自动重试。该上传链路仅通过模拟测试，需真实文件验证。尚未接入糯米机角色 TTS 的自动合成。音色克隆成功不保证歌唱音色完全相似。

/ 保留只读积分与音色查询。凭证仅在页面内存，不提交代码。任务 ID 单独本地保存。无定时任务或数据库。没有翻唱、原曲导入或发布功能。历史画布 API 保留兼容，主测试页不调用。

源码已按真实成功抓包适配，实际 Worker 生成/音色上传仍需联调。测试通过不等于部署或真实生成成功。真实 HAR、录音、Cookie、动态令牌与个人 ID 禁止提交仓库。
