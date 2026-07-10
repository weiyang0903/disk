# 💾 Disk File Manager

**Language / 语言:** English | [简体中文](README.zh-CN.md)

---

![Python](https://img.shields.io/badge/Python-3.8+-blue?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-2.2.5-lightgrey?logo=flask&logoColor=white)
![SQLite](https://img.shields.io/badge/Database-SQLite-blue?logo=sqlite&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-informational?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

A local file catalog management system. It helps you record and organize files and folders scattered across your hard drives. You can browse, search, add, edit, delete, import, and export records — all through a clean web interface running entirely on your own computer.

---

## ✨ Features

- 📁 **Folder Tree Navigation** — Browse your file records with a sidebar folder tree, just like a real file explorer.
- 🔍 **Advanced Search** — Search by file name, file path, description, file format, or last updated date. Multiple filters can be used at the same time.
- ➕ **Add / Edit / Delete Records** — Manually add files and folders. Edit any record or remove it at any time.
- 📥 **Bulk Import from Local Disk** — Browse your actual hard drive inside the app and import files and folders into the database in one go.
- 📤 **Export Data** — Export all records, a specific folder, or selected items as **JSON** or **CSV** files.
- 📊 **Statistics Dashboard** — See how many files and folders you have, file type breakdown, total storage size, and recently added items.
- 🌐 **Multi-language Interface** — The UI supports **Simplified Chinese**, **Traditional Chinese**, **English**, and **Japanese**. Switch at any time from the toolbar.
- 🗂️ **Grid & List View** — Switch between grid view and list view for your records.
- 📝 **Operation Logs** — All actions are logged locally in the `system_log` folder for your reference.
- 🔄 **File Tree Viewer** — A separate `file_tree_viewer.html` page to visualize a folder structure at a glance.

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.8 or above** is required.
- The code has been tested and is compatible up to Python 3.14.

### Installation (Windows)

#### Option A — Automatic Setup (Recommended)
1. Download or clone the source files
2. Make sure **Python 3.8+** is installed and added to your system `PATH`.
3. Double-click **`setup.bat`** in the project root folder.
4. The script will automatically:
   - Check your Python version
   - Create a virtual environment (`python/myenv/`)
   - Install all required packages from `python/requirements.txt`

#### Option B — Manual Setup
1. Download or clone the source files
2. Open a terminal (Command Prompt or PowerShell) and run the following commands:
   ```bash
   # Go into the python folder
   cd python

   # Create a virtual environment
   python -m venv myenv

   # Activate the virtual environment
   myenv\Scripts\activate

   # Install dependencies
   pip install -r requirements.txt
   ```

---

### Installation (macOS)
1. Download or clone the source files
2. Open **Terminal** and run the following commands from the project root:
   ```bash
   # Go into the python folder
   cd python

   # Create a virtual environment
   python3 -m venv myenv

   # Activate the virtual environment
   source myenv/bin/activate

   # Install dependencies
   pip install -r requirements.txt
   ```

---

## ▶️ How to Run

### Windows

#### Option A — Quick Launch Script

Double-click **`disk.bat`** in the project root. It will activate the virtual environment and start the server automatically.

#### Option B — Manual Launch

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

After starting, open your browser and go to:

```
http://127.0.0.1:5000
```

---

## 🔒 Privacy & Security

Your data and privacy are fully protected:

- **All data is stored locally.** The database (`python/file_manager.db`) is a local SQLite file on your computer. No data is ever sent to any server or cloud service.
- **Read-only file scanning.** When you browse your hard drive for bulk import, the system only **reads** the file and folder names and sizes. It does **not** modify, move, copy, or delete any of your files.
- **No internet connection required.** The app runs entirely on your local machine (`127.0.0.1`). No network access is needed after setup.
- **No account or login.** There is no user account system. No personal information is collected.

---

## 📁 File Structure

```
Disk-Manager/
├── index.html              # Main web interface
├── file_tree_viewer.html   # File tree viewer page
├── disk.bat                # Quick launch script (Windows)
├── setup.bat               # Automatic setup script (Windows)
│
├── css/
│   └── style.css           # Application styles
│
├── js/
│   ├── script.js           # Main frontend logic
│   └── translations.js     # UI translation strings
│
├── python/
│   ├── main.py             # Flask backend server & REST API
│   ├── logger.py           # Operation logger (multilingual)
│   ├── cleanup_db.py       # SQLite lock file cleanup utility
│   ├── requirements.txt    # Python dependencies
│   ├── system_language.json # Saved language preference
│   └── myenv/              # Virtual environment (created during setup)
│
└── system_log/             # Operation log files (auto-generated)
```

---

## 📝 Notes

- The virtual environment folder (`python/myenv/`) is created locally and does not need to be shared or committed to version control.
- The database file (`python/file_manager.db`) is also local. Back it up if you have important records.
- If you encounter a database lock error (e.g., after a crash), run `python cleanup_db.py` inside the `python/` folder to clean up leftover SQLite WAL files.
- The system log files are saved in the `system_log/` folder. They are for local reference only and are never uploaded.
- The backend server runs on port `5000` by default. Make sure no other application is using that port.
- This project uses `Waitress` as the production WSGI server. If Waitress is not installed, it will fall back to the Flask built-in development server.

---

## 🤝 Credits

This project was built with the assistance of AI tools. The design, logic, and features were planned and directed by the developer, with AI helping to write and review code throughout the process.

---

*Made with ❤️ — a personal tool to keep hard drive files organized.*
