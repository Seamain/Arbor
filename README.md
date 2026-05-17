<div align="center">
  <img src="public/icon.png" alt="Arbor" width="96" height="96" />

  <h1>Arbor</h1>

  <p>
    <strong>A beautiful, native Git GUI built with Tauri 2 + React 19</strong><br/>
    <strong>美观的原生 Git 图形界面客户端，基于 Tauri 2 + React 19 构建</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="version" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square" alt="platform" />
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
    <img src="https://img.shields.io/badge/Tauri-2.x-orange?style=flat-square&logo=tauri" alt="tauri" />
    <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" alt="react" />
  </p>
</div>

---

## ✨ Features / 功能特性

| Feature | 功能 |
|---------|------|
| 🌳 Visual commit graph with branch lanes | 可视化提交图，支持分支泳道 |
| 🔀 Branch management — create, checkout, merge, rebase, delete | 分支管理——创建、切换、合并、变基、删除 |
| 📋 Staged / unstaged diff viewer | 已暂存 / 未暂存文件的差异查看器 |
| ⚡ Conflict resolver with visual and raw editor modes | 冲突解决器，支持可视化和原始编辑两种模式 |
| 🔐 GitHub & GitLab OAuth (one-click sign-in) | GitHub / GitLab OAuth 一键登录 |
| 🔑 Personal Access Token support for GitHub, GitLab, Gitee | 支持 GitHub / GitLab / Gitee 个人访问令牌 |
| 📥 Clone repositories with search | 仓库搜索与克隆 |
| 🔔 PR / MR panel with live list | 实时拉取请求 / 合并请求面板 |
| 🌍 English / 简体中文 / 繁體中文 | 三语界面 |
| 🎨 Glassmorphism UI, light / dark / system theme | 玻璃拟态 UI，支持亮色 / 暗色 / 跟随系统 |
| 🖥️ Native file watcher for auto-refresh | 原生文件监听自动刷新 |
| ⌨️ macOS native menu bar integration | macOS 原生菜单栏集成 |

---

## 🖼️ Screenshots / 截图

> Coming soon — screenshots will be added after the first stable release.
> 截图将在首个稳定版本发布后补充。

---

## 📦 Download / 下载安装

Go to the [**Releases**](../../releases) page and download the package for your platform.

前往 [**Releases**](../../releases) 页面，下载适合您平台的安装包。

| Platform | Format | Architecture |
|----------|--------|-------------|
| macOS | `.dmg` | `x86_64` (Intel) · `aarch64` (Apple Silicon) |
| Linux | `.deb` · `.rpm` · `.AppImage` | `x86_64` · `arm64` |
| Windows | `.msi` | `x86_64` · `arm64` |

### macOS

```bash
# Intel Mac
open Arbor_0.1.0_x64.dmg

# Apple Silicon (M1/M2/M3/M4)
open Arbor_0.1.0_aarch64.dmg
```

> **Gatekeeper note / Gatekeeper 说明:** If macOS blocks the app, run:
> 若 macOS 阻止启动，请在终端执行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/Arbor.app
> ```

### Linux

```bash
# Debian / Ubuntu (.deb)
sudo dpkg -i arbor_0.1.0_amd64.deb

# RHEL / Fedora / openSUSE (.rpm)
sudo rpm -i arbor-0.1.0-1.x86_64.rpm

# Any distro (.AppImage)
chmod +x Arbor_0.1.0_x86_64.AppImage
./Arbor_0.1.0_x86_64.AppImage
```

### Windows

Run the `.msi` installer and follow the setup wizard.
双击 `.msi` 安装程序并按向导完成安装。

---

## 🛠️ Development / 开发环境

### Prerequisites / 前置依赖

| Tool | Version | Notes |
|------|---------|-------|
| [Rust](https://rustup.rs/) | stable (≥ 1.77) | `rustup update stable` |
| [Node.js](https://nodejs.org/) | ≥ 20 LTS | |
| [npm](https://npmjs.com/) | ≥ 10 | bundled with Node.js |
| Tauri CLI | 2.x | installed via npm |
| Git | any | must be in `PATH` |

**macOS additional / macOS 额外依赖:**

```bash
xcode-select --install
```

**Linux additional / Linux 额外依赖:**

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel curl \
  wget file libappindicator-gtk3-devel librsvg2-devel
```

**Windows additional / Windows 额外依赖:**

Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) or Visual Studio 2022 with the "Desktop development with C++" workload.
安装 [Microsoft C++ 生成工具](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 或包含「使用 C++ 的桌面开发」工作负载的 Visual Studio 2022。

---

### Setup / 安装

```bash
# 1. Clone the repository / 克隆仓库
git clone https://github.com/yourname/arbor.git
cd arbor

# 2. Install JS dependencies / 安装 JS 依赖
npm install

# 3. Install Rust cross-compilation targets / 安装 Rust 交叉编译目标
#    macOS
rustup target add x86_64-apple-darwin aarch64-apple-darwin
#    Linux
rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu
#    Windows
rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc
```

### Dev server / 开发服务器

```bash
npm run tauri dev
```

Hot-reload is enabled for the React frontend. Rust changes require a restart.
React 前端支持热重载；Rust 代码修改后需要重启。

### Quick local build / 快速本地编译

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`.
产物位于 `src-tauri/target/release/bundle/`。

---

## 📜 Build Scripts / 编译脚本

The `scripts/` directory contains automated build scripts for all platforms.
`scripts/` 目录包含所有支持平台的自动化编译脚本。

```
scripts/
├── build.sh       # macOS & Linux (bash)
└── build.ps1      # Windows (PowerShell)
```

### macOS & Linux

```bash
chmod +x scripts/build.sh

# Build all targets for the current platform / 编译当前平台所有架构
./scripts/build.sh

# Specific platform and architecture / 指定平台和架构
./scripts/build.sh --platform macos
./scripts/build.sh --platform linux
./scripts/build.sh --platform macos  --arch x86_64
./scripts/build.sh --platform macos  --arch aarch64
./scripts/build.sh --platform linux  --arch x86_64
./scripts/build.sh --platform linux  --arch arm64
```

### Windows (PowerShell)

```powershell
# Recommended: run as Administrator / 建议以管理员身份运行

# Build all Windows targets / 编译所有 Windows 架构
.\scripts\build.ps1

# Specific architecture / 指定架构
.\scripts\build.ps1 -Arch x86_64
.\scripts\build.ps1 -Arch arm64
```

### Output / 产物目录

All artifacts are collected into `dist-packages/`:
所有打包产物汇总至 `dist-packages/`：

```
dist-packages/
├── macos/
│   ├── Arbor_0.1.0_x64.dmg
│   └── Arbor_0.1.0_aarch64.dmg
├── linux/
│   ├── arbor_0.1.0_amd64.deb
│   ├── arbor_0.1.0_arm64.deb
│   ├── arbor-0.1.0-1.x86_64.rpm
│   ├── arbor-0.1.0-1.aarch64.rpm
│   ├── Arbor_0.1.0_x86_64.AppImage
│   └── Arbor_0.1.0_aarch64.AppImage
└── windows/
    ├── Arbor_0.1.0_x64_en-US.msi
    └── Arbor_0.1.0_arm64_en-US.msi
```

---

## ⚙️ Configuration / 配置

Settings are persisted in the OS app-data directory:
设置持久化于操作系统的应用数据目录：

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/com.seamainzhang.arbor/` |
| Linux | `~/.config/com.seamainzhang.arbor/` |
| Windows | `%APPDATA%\com.seamainzhang.arbor\` |

### OAuth / OAuth 配置

GitHub and GitLab OAuth credentials are embedded — no extra configuration needed.
GitHub 和 GitLab 的 OAuth 凭据已内置，无需额外配置。

For self-hosted GitLab, enter your instance URL in **Git Accounts → Add Account → Host**.
如需使用自托管 GitLab，请在「Git 账户 → 添加账户 → 主机」中填写实例地址。

---

## 🏗️ Project Structure / 项目结构

```
arbor/
├── src/                        # React frontend / React 前端
│   ├── App.tsx                 # Root component / 根组件
│   ├── App.css                 # Global styles / 全局样式
│   ├── components/             # UI components / UI 组件
│   │   ├── CloneModal.tsx
│   │   ├── ConflictModal.tsx
│   │   ├── ContextMenu.tsx
│   │   ├── GitGraphViewer.tsx
│   │   ├── LocalChangesModal.tsx
│   │   ├── ProvidersModal.tsx
│   │   ├── PullRequestsPanel.tsx
│   │   └── SettingsModal.tsx
│   ├── i18n/                   # Internationalization / 国际化
│   │   ├── en.ts
│   │   ├── zh-CN.ts
│   │   └── zh-TW.ts
│   ├── providers.ts            # Git provider logic / Git 提供商逻辑
│   ├── settings.ts             # App settings / 应用设置
│   └── notify.ts               # Notifications / 通知
├── src-tauri/                  # Rust backend / Rust 后端
│   ├── src/
│   │   ├── main.rs             # Entry point / 入口
│   │   ├── lib.rs              # Tauri commands / Tauri 命令
│   │   ├── git.rs              # Git operations / Git 操作
│   │   └── oauth.rs            # OAuth flow / OAuth 流程
│   ├── icons/                  # App icons / 应用图标
│   ├── Cargo.toml
│   └── tauri.conf.json
├── scripts/
│   ├── build.sh                # macOS & Linux build script
│   └── build.ps1               # Windows build script
└── public/                     # Static assets / 静态资源
```

---

## 🔧 Tech Stack / 技术栈

| Layer | Technology |
|-------|-----------|
| Framework | [Tauri 2](https://tauri.app/) |
| Frontend | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| UI Library | [HeroUI v3](https://www.heroui.com/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Build tool | [Vite](https://vitejs.dev/) |
| Backend | [Rust](https://www.rust-lang.org/) stable |
| OAuth | Authorization Code Flow (embedded client_secret) |
| i18n | React Context (zero dependencies) |

---

## 🤝 Contributing / 贡献

1. Fork the repository / Fork 仓库
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes following [Conventional Commits](https://www.conventionalcommits.org/)
4. Push and open a Pull Request / 推送并提交 Pull Request

Please add translations for any new UI strings in all three locale files (`en.ts`, `zh-CN.ts`, `zh-TW.ts`).
新增 UI 字符串时，请同步在三个语言文件中添加对应翻译。

---

## 📄 License / 许可证

[MIT](LICENSE) © 2026 Seamain
