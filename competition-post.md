# 学习工作赛道 - Arbor：美观的原生 Git 图形界面客户端

---

## 一、Demo 简介

**Arbor** 是一款基于 Tauri 2 + React 19 构建的跨平台原生 Git 图形界面客户端（桌面 App），支持 macOS、Linux 和 Windows 三大平台。

**面向谁：** 日常使用 Git 进行版本管理的开发者、设计师、技术写作者——尤其是那些觉得命令行 Git 不够直观、又嫌 GitHub Desktop 功能太少、Sourcetree 太笨重的用户。

**核心功能：**

### 1. 可视化提交图与分支管理

Arbor 提供了带有分支泳道的可视化提交图，用户可以直观地查看仓库的提交历史、分支结构和合并关系。支持创建分支、切换分支、合并、变基（rebase）、删除分支等完整操作。

> 📌 *请在此插入截图：Arbor 主界面，展示可视化提交图和分支面板*

### 2. 智能变更管理

左右分栏式布局，左侧提交图 + PR 面板，右侧变更文件列表 + Diff 查看器。支持文件级暂存/取消暂存、行级 Diff 高亮、冲突可视化解决器，以及一键丢弃变更。

> 📌 *请在此插入截图：展示变更列表和 Diff 查看器*

### 3. AI 智能提交信息生成

Arbor 集成了 AI 提交信息生成功能，支持远程 AI（如 OpenAI 兼容接口）和本地 LLM（基于 llama.cpp 的 GGUF 模型）。用户只需点击一个按钮，AI 就会根据当前 Diff 自动生成符合 Conventional Commits 规范的提交信息。

> 📌 *请在此插入截图：展示 AI 生成提交信息的功能*

**其他亮点功能：**
- GitHub / GitLab OAuth 一键登录（PKCE 安全流程）
- GitHub / GitLab / Gitee Personal Access Token 支持
- 仓库搜索与一键克隆
- PR / MR 实时列表面板
- 玻璃拟态（Glassmorphism）UI，支持亮色/暗色/跟随系统主题
- 原生文件监听自动刷新
- English / 简体中文 / 繁體中文 三语界面
- macOS 原生菜单栏集成与键盘快捷键

---

## 二、Demo 创作思路

### 灵感来源

作为一名日常使用 Git 的开发者，我长期在命令行和各种 Git GUI 工具之间反复切换。命令行功能强大但学习曲线陡峭；GitHub Desktop 简洁但功能有限；Sourcetree 功能齐全但体积臃肿、启动缓慢。我一直在寻找一个「既美观又轻量、既易用又功能完整」的 Git 客户端。

在接触到 Tauri 2 后，我发现可以用 Rust + Web 技术栈构建出体积极小、启动极快的原生桌面应用。这让我看到了打造理想 Git 客户端的技术路径。

### 想解决的问题

1. **现有 Git GUI 普统笨重：** Electron 应用动辄 100MB+，内存占用高。Arbor 基于 Tauri 2，最终包体积仅 10-20MB，内存占用约为 Electron 应用的 1/3。
2. **命令行 Git 不够直观：** 提交历史、分支关系、合并冲突在命令行中难以可视化理解。Arbor 的可视化提交图和冲突解决器让这些操作一目了然。
3. **提交信息撰写繁琐：** 很多开发者（包括我）写提交信息时经常词穷或格式不统一。Arbor 的 AI 提交信息生成功能可以一键生成规范的提交信息，提升开发效率。
4. **多平台 Git 账户管理碎片化：** 同时使用 GitHub、GitLab、Gitee 的用户需要在多个平台间切换。Arbor 统一了多平台账户管理和 PR 查看体验。

### 为什么做这个方向

- **技术价值：** Tauri 2 是 2024 年才正式发布的框架，展示 Rust + Web 前端的现代桌面开发能力，具有技术前瞻性。
- **用户价值：** Git 是每个开发者的刚需工具，一个更好的 Git 客户端能切实提升日常开发体验。
- **差异化：** 市面上缺少「轻量 + 美观 + 功能完整 + AI 加持」的 Git 客户端，Arbor 填补了这个空白。
- **AI 融合：** 将 AI 能力（本地 LLM + 远程 API）自然融入开发者工作流，而非生硬地加一个聊天框。

---

## 三、Demo 体验地址

> 📌 *请根据实际情况选择以下一种方式：*
>
> **方式一（推荐）：部署可公开访问的体验链接**
> - 下载地址：https://github.com/seamainzhang/arbor/releases
> - 前往 Releases 页面下载对应平台的安装包
>
> **方式二：交互式 HTML 体验文件**
> - 请将打包后的 HTML 文件以 Zip 格式上传到社区
>
> **方式三：演示视频**
> - 视频链接：*请上传到第三方平台后填写公开链接*

### 快速安装

| 平台 | 格式 | 说明 |
|------|------|------|
| macOS | `.dmg` | 支持 Intel 和 Apple Silicon |
| Linux | `.deb` / `.rpm` / `.AppImage` | 支持 x86_64 和 arm64 |
| Windows | `.msi` | 支持 x64 和 arm64 |

> macOS 首次打开若被拦截，请在终端执行：
> ```bash
> xattr -dr com.apple.quarantine /Applications/Arbor.app
> ```

---

## 四、TRAE 实践过程

### 开发流程概述

Arbor 的完整开发过程均在 TRAE IDE 中完成，涵盖了从项目初始化、架构设计、功能实现、安全加固到性能优化的全流程。以下是关键开发阶段的展示：

### 阶段一：项目架构设计与初始化

使用 TRAE 创建 Tauri 2 + React 19 + TypeScript 项目骨架，配置 Vite 构建工具、Tailwind CSS 4 和 HeroUI 组件库。定义了前后端的模块结构：Rust 后端负责 Git 操作（git2 库）、OAuth 认证和本地 AI 推理；React 前端负责 UI 渲染和状态管理。

> 📌 *请插入截图：TRAE 中项目初始化和架构设计的对话过程*

**关键 Session ID：** `6a33b8370d34f496a9b57d99`

> 📌 *请补充另外 2 个开发阶段的 Session ID（如下方占位所示）：*
> - Session ID 2：`___________`（功能开发阶段）
> - Session ID 3：`___________`（安全加固与性能优化阶段）

### 阶段二：核心功能开发

通过 TRAE 的 AI 辅助，实现了以下核心功能模块：

1. **Git 操作层（Rust）：** 使用 git2 库实现了 40+ 个 Tauri 命令，包括 status、fetch、pull、push、merge、rebase、stash、diff、log graph 等完整 Git 操作。
2. **可视化提交图（React）：** 自主实现了带有分支泳道布局的 SVG 提交图组件，支持提交节点、分支连线、HEAD 标记的渲染。
3. **冲突解决器：** 实现了支持可视化和原始编辑两种模式的冲突解决器，能解析 Git 冲突标记并高亮显示。
4. **OAuth 认证流程：** 实现了 GitHub/GitLab 的本地服务器 OAuth 流程，包括 PKCE 安全机制。
5. **AI 提交信息生成：** 集成了远程 AI API 和本地 llama.cpp 推理，能根据 Diff 自动生成提交信息。
6. **国际化系统：** 基于 React Context 实现了零依赖的三语国际化（English / 简体中文 / 繁體中文）。

> 📌 *请插入截图：在 TRAE 中开发 Git 操作和提交图组件的对话过程*

### 阶段三：安全加固

通过 TRAE 进行了全面的安全审查和修复：

1. **OAuth PKCE 改造：** 为 OAuth 流程添加了 PKCE（Proof Key for Code Exchange）支持，生成每次会话独立的 code_verifier，防止授权码截获攻击。
2. **CSP 安全策略：** 配置了严格的 Content Security Policy，限制脚本、图片、连接的来源。
3. **路径遍历防护：** 为文件读写操作添加了 `safe_join()` 路径校验，防止 `../` 路径遍历攻击。
4. **命令注入防护：** 对 `open_in_editor` 的编辑器参数进行 shell 元字符过滤。
5. **模型下载域名白名单：** 限制 AI 模型只能从可信域名（HuggingFace、GitHub）下载。

> 📌 *请插入截图：在 TRAE 中进行安全审查和修复的对话过程*

### 阶段四：性能优化

通过 TRAE 分析并修复了多个性能问题：

1. **前端代码分割：** 使用 `React.lazy` + `Suspense` 将 8 个模态组件延迟加载，配合 Vite 的 `manualChunks` 拆分第三方库，减少首屏 JS 解析时间约 40-60%。
2. **启动流程优化：** 将原生菜单构建（`build_menu`）移到异步任务中，让窗口能更快完成首帧绘制。
3. **跨平台窗口效果：** 精确控制 macOS vibrancy 和 Windows acrylic 的应用时机——同步应用以保证透明效果正确，异步处理菜单构建以加速启动。

> 📌 *请插入截图：在 TRAE 中进行性能分析和优化的对话过程*

---

## 五、开发心得与经验总结

### 技术选型的思考

选择 Tauri 2 而非 Electron 是本项目最关键的决策。Tauri 2 带来了：
- **体积极小：** 最终安装包 10-20MB，而同等功能的 Electron 应用通常 100MB+
- **性能优异：** Rust 后端直接调用系统 API，无 V8 中间层
- **安全可靠：** Rust 的内存安全特性 + Tauri 的权限系统

### AI 辅助开发的体会

在 TRAE 中开发 Arbor 的过程中，AI 辅助在以下方面发挥了重要作用：
- **快速原型：** 描述需求后，AI 能快速生成功能完整的代码框架
- **安全审查：** AI 能识别出我遗漏的安全问题（如路径遍历、命令注入）
- **跨平台适配：** AI 熟悉各平台的差异，能提供准确的平台特定代码
- **性能诊断：** AI 能分析启动慢等性能问题的根因并给出优化方案

### 遇到的挑战

1. **macOS vibrancy 时序问题：** 将窗口效果移到异步任务后导致侧边栏透明度过高，最终发现 vibrancy 必须在窗口首帧绘制前同步应用。
2. **GitHub OAuth PKCE 限制：** GitHub OAuth App 在 token 交换阶段仍要求 client_secret，不完全符合 OAuth 2.1 规范，需要同时发送 client_secret 和 code_verifier。
3. **Tauri 2 的 Option vs Result：** `get_webview_window` 返回 `Option` 而非 `Result`，在返回 `Result` 的闭包中需要用 `.ok_or()` 转换。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Tauri 2 |
| 前端 | React 19 + TypeScript |
| UI 库 | HeroUI v3 |
| 样式 | Tailwind CSS v4 |
| 图标 | Lucide React |
| 构建工具 | Vite |
| 后端 | Rust stable |
| OAuth | Authorization Code Flow + PKCE (RFC 7636) |
| 国际化 | React Context（零依赖） |
| 本地 AI | llama.cpp (GGUF) |
| Git 引擎 | git2 (libgit2) |

---

> **注意事项（提交前请删除此部分）：**
>
> 1. **截图：** 需要补充至少 3 张开发关键步骤截图，建议截取 TRAE 中的对话界面和代码编辑过程。
> 2. **Session ID：** 当前仅有 1 个 Session ID（`6a33b8370d34f496a9b57d99`），需补充另外 2 个来自不同开发阶段的 Session ID。请在 TRAE 中查看历史对话记录获取。
> 3. **体验地址：** 请选择三种方式之一并填写实际链接/上传文件。
> 4. **标签选择：** 建议选择「学习工作」标签，因为 Arbor 是面向开发者的生产力工具。
> 5. 标记有 📌 的部分需要你手动补充实际内容。
