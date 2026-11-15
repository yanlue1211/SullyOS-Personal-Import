# 🌱 个人二改｜新窗口从这里开始

> 这是 **yanlue1211 的 SullyOS 个人二改维护入口**，不是原作者的版本说明。此文档用于防止新窗口选错分支、重复开发、覆盖已完成的功能。**请从当前分支实际 HEAD 和最近一次成功 Pages 部署确认版本，不要把本文写下的旧 SHA 当作永远最新的版本。**
>
> 最近整理：2026-11-16。仅记录入口和开发规则，不修改记忆机制、不清理用户数据、不改变原作者功能。

## 一句话：下一次从哪里开始

**糯米机正式整合源码唯一入口：[`personal/audio-listening`](https://github.com/yanlue1211/SullyOS-Personal-Import/tree/personal/audio-listening)**。

- **不要默认使用仓库默认分支 `TIAO-Capacitor`，也不要把 `master` 当作最新版。** 两者不是个人网页正式运行版。
- 新窗口先读取 `personal/audio-listening` **当时最新的提交**，再确认 [GitHub Pages 部署工作流](https://github.com/yanlue1211/SullyOS-Personal-Import/actions/workflows/deploy-pages.yml) 中对应 SHA 的运行结果。
- 截至本次整理前，最新已合并功能提交：**`b15c26fd0887d4c3c41f4bccd38b7b351caedc88`**（合并 PR #144，海绵 / MiniMax / ACE-Step 演唱完成卡），同 SHA 的 Pages 工作流成功。**这是历史锚点，不是未来固定 HEAD**。
- 文档整理等非功能提交也会改变 HEAD、可能触发部署；区分 **「最新源码 HEAD」**、**「最近功能提交」**、**「最新成功部署 SHA」** 和 **「用户手机实际加载的网页版本」**。
- 网页正式版本由 `.github/workflows/deploy-pages.yml` 的 push 分支 `personal/audio-listening` 控制；Worker、APK 各有自己的部署/构建流程，**网页部署成功≠Worker 或 APK 已更新**。
- 日常新功能：以当前正式 HEAD 为基线创建隔离工作分支 → 修改/测试 → 检查其他已实现功能 → 合并回 `personal/audio-listening` → 等 Pages 成功 → 真实使用核验。用户通常不会对同一项目并行开窗，因此**最新合并 HEAD 就是继续开发的默认依据**；仍不要用一个旧开发分支覆盖它。

## 各项目与仓库（不要混）

| 项目 | 仓库 / 定位 | 注意 |
|---|---|---|
| 糯米机正式二改 | [SullyOS-Personal-Import](https://github.com/yanlue1211/SullyOS-Personal-Import) | 当前仓库；**网页正式源：`personal/audio-listening`** |
| 原作者糯米机 | [qegj567-cloud/SullyOS](https://github.com/qegj567-cloud/SullyOS) | 上游来源，更新前对照融合，不覆盖个人功能 |
| 点点栖普通 / GPT 版 | [TapNest](https://github.com/yanlue1211/TapNest) | **另外一个仓库**；普通 `main`，GPT `personal/gpt-edition`，包名各自独立。别把 GPT 版改动直接当普通版最新版 |
| 歌曲文件直链 | [yan](https://github.com/yanlue1211/yan) | 歌曲资源仓库，不是音乐生成服务源码 |
| 自动备份 | `sully-backup`（私人仓库） | **明确保护，不删、不移动、不修改；数据可能存于其他位置** |
| 小红书 MCP | `GPT-XHS-MCP`（私人仓库） | 独立未完成项目，当前先不动 |
| 旧空仓库 | `SullyOS-Personal`（私人仓库） | 早期未继续使用；与本项目不同，用户允许删除空仓库，但不可误删这个正式仓库 |

海绵音乐 **已经接入糯米机正式写歌功能**，其接入代码在本仓库，另有独立的 `nuomi-haimian` Cloudflare Worker；历史 `deploy/haimian-probe` 是测试分支，**不是另一个 GitHub 仓库，也不是网页正式版**。它使用官网非公开接口，接口/音色/上传和生成行为都以实际测试为准；密钥与 Cookie 绝不写入源码。

## 功能位置与开发禁区

| 要开发 / 排查的功能 | 优先打开 |
|---|---|
| 写歌页面、歌词本、共创聊天与写歌卡 | `apps/SongwritingApp.tsx`、`components/song/SongwritingStudio.tsx`、`features/songwriting/`、`docs/songwriting-personal.md` |
| 海绵生成、完成后播放、下载与歌单导入 | `components/song/HaimianProduction.tsx`、`features/songwriting/{production,download,musicLibrary}.ts`、`components/settings/HaimianMusicSettings.tsx` |
| 音频识别与一起听 | `utils/audioApi.ts`、`utils/songListening.ts`、`utils/songAudioConversion.ts` |
| 原生记忆系统 | `docs/memory-system-overview.md`、`utils/memoryPalace/`；**只读核心，未经用户确认不改提取、总结、权重、召回算法** |
| 角色上下文、原私聊事件和卡片 | `utils/chatRequestPayload.ts`、`utils/chatContextRange.ts`、`features/songwriting/storage.ts`、`docs/character-facing-cards.md` |
| 其他功能与全量文档导航 | `AGENTS.md`；相关模块先读该文件对应的专用文档 |

**角色可读卡片**：角色完成写歌、演唱、游戏、造物等成果时，正常描述角色完成了什么；**不要给角色展示模型、AI、接口或生成过程，也不用特意强调「是他自己做的」**。后台技术状态和费用仍必须对用户真实说明。

**安全底线**：不擅改作者记忆核心、不动 Lite 的个人功能、不删角色/聊天/有效素材、不进行高风险数据库迁移；新增存储需核对完整/文字/媒体备份；保护缓存、同步、事件监听、Worker 与原作者更新的可融合性。不因单个新功能清理、重构不相关模块。

## 当前进行中 / 尚未并入正式版

- **Char 自主谱曲试用**：正式整合 PR [#146](https://github.com/yanlue1211/SullyOS-Personal-Import/pull/146) 已合并进 `personal/audio-listening`（功能合并提交 `1eee407de24b66500a1de1c7619c9472ba9955e4`）。写歌页追加「自主谱曲」：八小节逐音谱写、abcjs 五线谱与 WAV/MIDI、本版音频 API **纯客观描述**、Char 局部修订、版本选择。**独立八小节试听页已在用户 HarmonyOS 手机上确认能正常播放**；实际 Char 谱曲 + 音频 API + 修订尚需用户从正式页面逐步验收；海绵参考旋律上传未接。旧实验草稿 [#145](https://github.com/yanlue1211/SullyOS-Personal-Import/pull/145) 仅供历史回退参考，不能拿旧分支覆盖正式版。当前仍使用远程脚本/音色，应在真机验证后考虑随包打包。
- **其他旧功能分支与待合并 PR**：仓库存在大量历史分支，名称不代表是否已经实现或合并。例如 [#108](https://github.com/yanlue1211/SullyOS-Personal-Import/pull/108) 仍是开放状态。先比较最新正式 HEAD 与候选分支的提交和代码，判断是否有独立成果或只是已落地的历史修复。**不能批量删除、批量合并，更不能简单认定「旧分支里所有新功能都没有了」**。
- 其他客户端的点点栖 APK、AMSG Cloudflare Worker、小红书 MCP，分别按自己的仓库/工作流/部署状态判断，不随网页自动更新。

## 每次新窗口的标准操作

1. **先读本文件和 `AGENTS.md`**，确定本次功能真实属于哪个仓库。
2. **拿最新正式提交**：查看 `personal/audio-listening` 的 HEAD、最新合并记录与最近成功的 Pages 工作流；不要使用默认分支。
3. **查是否已做**：读相关源码、已有功能入口、现存 PR/测试；不要根据文档旧描述重复开发或误删入口。
4. **做最小改动**：尽量独立组件/适配层；保留原数据路径，涉及新卡片统一使用原私聊、上下文和记忆入口，不造记忆系统。
5. **核对兼容与版本**：至少跑相应单测和构建；功能涉及聊天/通话/音乐/相册/记忆/备份/Worker 时扩展回归。
6. **部署验证**：合并到正式分支后确认对应 SHA 的 Pages 工作流 **success**；必要时单独确认 Worker 部署及手机实际运行。不要说「代码测试通过就是已经上线」。
7. **交接记录**：说明【起点 HEAD → 改动与 commit → 测试 → 合并后正式 HEAD → 部署 SHA → 未解决事项】。未合并分支必须明确写出来。

## 对大量分支、旧文档的处理原则

- 本文是 **当前工作入口**；`AGENTS.md` 仍是模块/作者文档总索引，`README.md` 是原版项目介绍与授权说明，不要为「整洁」整篇替换。
- 旧分支属于历史与回退材料；清理前必须确认 **已合并或已有替代、没有未入主线的独立修改、没有其他 Worker/APK/实验使用它**。清理时记录候选名单，先留回退，再逐项处理。不同项目的分支不混在一起删。
- `docs/`、`plans/`、`experiments/`、`test/`、`worker/` 等目录不能因为文件多就直接删除；部分是原作者基础或仍在调用的测试/部署入口。
- **不触碰自动备份仓库和其任何自动化**；也不要在此轮清理尚未完成的小红书项目。
