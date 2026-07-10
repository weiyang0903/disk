# 💾 硬盘文件管理器

**Language / 语言:** [English](README.md) | 简体中文

---

![Python](https://img.shields.io/badge/Python-3.8+-blue?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-2.2.5-lightgrey?logo=flask&logoColor=white)
![SQLite](https://img.shields.io/badge/数据库-SQLite-blue?logo=sqlite&logoColor=white)
![Platform](https://img.shields.io/badge/平台-Windows%20%7C%20macOS-informational?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/许可证-MIT-green)

一个本地文件目录管理系统，帮助你记录和整理分散在各个硬盘中的文件和文件夹。你可以通过一个简洁的网页界面进行浏览、搜索、添加、编辑、删除、导入和导出操作，整个系统完全运行在你自己的电脑上。

---

## ✨ 功能特点

- 📁 **文件夹树导航** — 通过侧边栏的文件夹树浏览你的文件记录，就像真正的文件资源管理器一样。
- 🔍 **高级搜索** — 可按文件名、文件路径、描述、文件格式或最后更新日期进行搜索，多个条件可同时使用。
- ➕ **添加 / 编辑 / 删除记录** — 手动添加文件和文件夹，随时编辑或删除任何记录。
- 📥 **从本地磁盘批量导入** — 直接在应用内浏览你的真实硬盘，一键将文件和文件夹批量导入数据库。
- 📤 **导出数据** — 将全部记录、指定文件夹或选中的项目导出为 **JSON** 或 **CSV** 格式。
- 📊 **数据统计面板** — 查看文件和文件夹的总数量、文件类型分布、总存储大小以及最近添加的项目。
- 🌐 **多语言界面** — 支持**简体中文**、**繁体中文**、**英语**和**日语**，可随时在工具栏切换语言。
- 🗂️ **网格与列表视图** — 自由切换网格视图或列表视图来查看记录。
- 📝 **操作日志** — 所有操作都会记录在本地的 `system_log` 文件夹中，方便查阅。
- 🔄 **文件树查看器** — 独立的 `file_tree_viewer.html` 页面，可直观展示文件夹结构。

---

## 🚀 安装说明

### 要求
- 需要 **Python 3.8 或更高版本**。
- 代码已通过测试，兼容至 Python 3.14。

### Windows

#### 方法一 — 自动安装脚本（推荐）
1. 下载或克隆源文件
2. 确保已安装 **Python 3.8+**，并已将其加入系统 `PATH`。
3. 在项目根目录中，双击运行 **`setup.bat`**。
4. 脚本会自动完成以下步骤：
   - 检测你的 Python 版本
   - 创建虚拟环境（`python/myenv/`）
   - 从 `python/requirements.txt` 安装所有依赖包

#### 方法二 — 手动安装
1. 下载或克隆源文件
2. 打开终端（命令提示符或 PowerShell），依次执行以下命令：
   ```bash
   # 进入 python 文件夹
   cd python

   # 创建虚拟环境
   python -m venv myenv

   # 激活虚拟环境
   myenv\Scripts\activate

   # 安装依赖
   pip install -r requirements.txt
   ```

---

### macOS
1. 下载或克隆源文件
2. 打开 **终端（Terminal）**，从项目根目录依次执行以下命令：
   ```bash
   # 进入 python 文件夹
   cd python

   # 创建虚拟环境
   python3 -m venv myenv

   # 激活虚拟环境
   source myenv/bin/activate

   # 安装依赖
   pip install -r requirements.txt
   ```

---

## ▶️ 如何运行

### Windows

#### 方法一 — 快速启动脚本

在项目根目录中，双击运行 **`disk.bat`**，脚本会自动激活虚拟环境并启动服务器。

#### 方法二 — 手动启动

```bash
cd python
myenv\Scripts\activate
python main.py
```

### macOS

```bash
cd python
source myenv/bin/activate
python main.py
```

启动后，打开浏览器，访问：

```
http://127.0.0.1:5000
```

---

## 🔒 隐私与安全

你的数据和隐私完全受到保护：

- **数据仅存储在本地。** 数据库文件（`python/file_manager.db`）是存储在你电脑上的本地 SQLite 文件，不会上传到任何服务器或云端服务。
- **只读扫描，不修改文件。** 当你通过应用浏览硬盘进行批量导入时，系统只会**读取**文件和文件夹的名称及大小，**不会**对你的任何文件进行修改、移动、复制或删除。
- **无需联网。** 应用完全运行在你本机（`127.0.0.1`），安装完成后不需要任何网络连接。
- **无账号，无登录。** 没有用户账号系统，不收集任何个人信息。

---

## 📁 项目结构

```
Disk-Manager/
├── index.html              # 主网页界面
├── file_tree_viewer.html   # 文件树查看器页面
├── disk.bat                # 快速启动脚本（Windows）
├── setup.bat               # 自动安装脚本（Windows）
│
├── css/
│   └── style.css           # 应用样式文件
│
├── js/
│   ├── script.js           # 主要前端逻辑
│   └── translations.js     # 界面翻译字符串
│
├── python/
│   ├── main.py             # Flask 后端服务器与 REST API
│   ├── logger.py           # 操作日志记录器（多语言）
│   ├── cleanup_db.py       # SQLite 锁定文件清理工具
│   ├── requirements.txt    # Python 依赖列表
│   ├── system_language.json # 已保存的语言偏好设置
│   └── myenv/              # 虚拟环境（安装时自动创建）
│
└── system_log/             # 操作日志文件（自动生成）
```

---

## 📝 备注

- 虚拟环境文件夹（`python/myenv/`）是在本地创建的，不需要提交到版本控制（如 Git）中。
- 数据库文件（`python/file_manager.db`）同样是本地文件。如果你有重要记录，请定期备份。
- 如果遇到数据库锁定错误（例如程序异常退出后），请在 `python/` 文件夹内运行 `python cleanup_db.py` 来清理残留的 SQLite WAL 文件。
- 操作日志保存在 `system_log/` 文件夹中，仅供本地查阅，不会上传。
- 后端服务器默认运行在 `5000` 端口，请确保该端口没有被其他程序占用。
- 本项目使用 [Waitress](https://docs.pylonsproject.org/projects/waitress/) 作为生产环境 WSGI 服务器。若未安装 Waitress，将自动回退到 Flask 内置的开发服务器。

---

## 🤝 致谢

本项目由开发者本人与 AI 工具共同完成。功能设计和整体方向由开发者规划主导，AI 在代码编写和审查过程中提供了辅助支持。

---

*用 ❤️ 制作 — 一个用来整理硬盘文件的个人小工具。*
