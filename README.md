# DiskMeta — 硬盘元数据管理器

## 目录结构
（见工程根目录文件列表）

## 依赖（Python）
在 `python/` 目录下创建并激活虚拟环境后安装：
```bash
pip install -r requirements.txt
pip install flask flask-cors

# 📁 File Manager Web App

一个轻量级的 **文件元数据管理系统**，用于帮助程序员记录和管理分散在多个硬盘中的文件与文件夹信息。  
本项目不存储实际文件，仅记录文件的元数据（如名称、描述、位置、格式等）。

---

## 🧭 项目概述

**目标：**  
创建一个 Web 应用，用于：
- 记录文件/文件夹的元数据；
- 按层次结构展示文件树；
- 快速搜索文件；
- 通过表单添加、编辑、删除记录；
- 支持导出与导入元数据（可扩展）；
- 展示总体文件统计信息。

**特点：**
- 不存储实际文件；
- 使用 SQLite 轻量级数据库；
- 支持层级结构（文件夹可包含文件或子文件夹）；
- 响应式、现代化前端界面；
- 可直接在 XAMPP + Flask 环境中运行。

---

## ⚙️ 技术栈

| 部分 | 技术 |
|------|------|
| 前端 | HTML5, CSS3, JavaScript (Fetch API) |
| 后端 | Python 3.x, Flask, Flask-CORS |
| 数据库 | SQLite3 |
| 环境 | XAMPP v3.2.2d |

---

## 🗂️ 目录结构
file_manager/
├── index.html # 前端主页面
├── css/
│ └── style.css # 页面样式
├── js/
│ └── script.js # 前端交互逻辑
├── python/
│ ├── main.py # Flask 后端主程序
│ ├── file_manager.db # SQLite 数据库（自动创建）
│ └── requirements.txt # Python 依赖
├── images/ # 图标与静态资源
└── README.md # 项目说明文档


---

## 💾 数据模型说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键，自增 |
| name | TEXT | 名称（必填） |
| description | TEXT | 描述（可选） |
| location | TEXT | 物理路径（文件必填） |
| format | TEXT | 文件格式（例如 mp4, pdf） |
| type | TEXT | 类型：`file` 或 `folder` |
| parent_id | INTEGER | 父级ID（支持层次结构） |

---

## 🚀 功能总览

### 📂 文件与文件夹管理
- **添加文件/文件夹**：通过表单输入元数据。
- **编辑文件/文件夹**：修改已记录的信息。
- **删除文件/文件夹**：移除记录。
- **层级结构支持**：文件夹可包含文件或其他文件夹。
- **自动统计格式分布**（例如 mp4、avi 数量）。

---

### 🔍 搜索功能
- 在顶部提供全局搜索栏。
- 支持按 **名称 / 描述 / 格式** 搜索。
- 搜索结果高亮显示。
- 可直接点击搜索结果查看详细信息。

---

### 📊 统计信息（可扩展）
- 显示数据库中所有文件的数量；
- 按格式分类的统计（例如：mp4=25，pdf=10）。

---

### 🔄 数据操作接口（RESTful API）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/items` | 获取所有项目 |
| `GET` | `/api/items/<id>` | 获取指定ID的项目详情 |
| `POST` | `/api/items` | 添加新项目（文件/文件夹） |
| `PUT` | `/api/items/<id>` | 更新指定项目 |
| `DELETE` | `/api/items/<id>` | 删除指定项目 |
| `GET` | `/api/search?q=关键字` | 搜索项目（名称/描述/格式） |

---

### 📥 导入 / 导出功能（建议扩展）
未来可支持以下功能：
- 导入 CSV/JSON 文件以批量添加记录；
- 导出数据库为 JSON 文件备份。

---

## 🖥️ 前端界面说明

主界面包含以下部分：
1. **顶部栏**
   - 搜索框
   - 添加按钮（新建文件或文件夹）
2. **左侧面板**
   - 文件夹树（层级展示）
3. **右侧面板**
   - 选中项目的详细信息（名称、描述、路径、格式、统计）
4. **响应式设计**
   - 支持桌面与移动端浏览。
   - 使用现代 CSS 布局（Flex + Grid）。

---

## 🧩 后端说明

- 采用 Flask 构建 RESTful API。
- 数据保存在 SQLite 数据库中。
- 支持 CORS（跨域请求）。
- 自动创建数据库文件：`python/file_manager.db`
- 兼容 **Python 3.14**（内置兼容补丁）。

---

## 🐍 Python 兼容补丁

由于 Python 3.14 移除了 `pkgutil.get_loader()`，本项目在 `main.py` 顶部加入了以下代码，以确保 Flask 可正常运行：

```python
import pkgutil
if not hasattr(pkgutil, "get_loader"):
    import importlib.util
    def get_loader(name):
        spec = importlib.util.find_spec(name)
        return spec.loader if spec else None
    pkgutil.get_loader = get_loader
