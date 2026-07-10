import os
import json
import re
from datetime import datetime
import logging

# Ensure ANSI escape codes work on Windows
try:
    import colorama
    colorama.init()
except ImportError:
    # On Windows, we can manually enable virtual terminal processing if colorama is not present
    import sys
    if sys.platform == 'win32':
        import ctypes
        try:
            kernel32 = ctypes.windll.kernel32
            # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass

# Directory and file configurations
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG_DIR = os.path.join(BASE_DIR, 'system_log')
LANG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'system_language.json')

# Active language (loaded dynamically)
_active_lang = 'zh-CN'

# Supported languages
SUPPORTED_LANGS = ['zh-CN', 'en', 'zh-TW', 'ja']

# ANSI Colors
C_RESET = "\033[0m"
C_RED = "\033[31m"
C_GREEN = "\033[32m"
C_WHITE = "\033[37m"

# Translation table for language codes to human names
LANG_NAMES = {
    'zh-CN': '简体中文 (Simplified Chinese)',
    'en': 'English',
    'zh-TW': '繁體中文 (Traditional Chinese)',
    'ja': '日本語 (Japanese)'
}

# Translation table for operations
TRANSLATIONS = {
    'zh-CN': {
        'list_root': '列出根目录下的所有文件和文件夹',
        'list_root_error': '列出根目录项目失败: {error}',
        'list_folder': '列出文件夹下的所有文件和文件夹 (父文件夹 ID: {parent_id})',
        'list_folder_error': '列出文件夹下的项目失败 (父文件夹 ID: {parent_id}): {error}',
        'add_item': '新建项目: 名称="{name}", 类型="{type}", 父目录 ID={parent_id}, 文件大小="{file_size}", 物理位置="{location}"',
        'add_item_error': '新建项目失败: 名称="{name}", 类型="{type}", 错误: {error}',
        'edit_item': '修改项目 (ID: {item_id}): 名称="{name}", 描述="{description}", 物理路径="{location}", 格式="{format_val}", 父目录 ID={parent_id}, 文件大小="{file_size}"',
        'edit_item_error': '修改项目 (ID: {item_id}) 失败: 错误: {error}',
        'delete_item': '删除项目 (ID: {item_id}, 共级联删除 {deleted_count} 个子项目)',
        'delete_item_error': '删除项目 (ID: {item_id}) 失败: 错误: {error}',
        'search': '搜索项目: 关键字="{query}", 搜索维度={fields}',
        'search_error': '搜索项目失败: 关键字="{query}", 错误: {error}',
        'stats': '获取系统存储和文件格式统计数据',
        'stats_error': '获取系统统计数据失败: 错误: {error}',
        'export': '导出项目数据: 格式="{format_type}", 范围="{scope}", 项目 ID={item_id}',
        'export_error': '导出项目数据失败: 错误: {error}',
        'import': '导入数据: 成功导入 {imported} 个项目',
        'import_error': '导入数据失败: 错误: {error}',
        'local_list': '浏览本地物理磁盘: 路径="{path}"',
        'local_list_error': '浏览本地物理磁盘失败: 路径="{path}", 错误: {error}',
        'local_resolve': '解析并扫描本地物理路径: 包含 {folders_count} 个文件夹，{files_count} 个文件',
        'local_resolve_error': '解析本地物理路径失败: 错误: {error}',
        'set_lang': '将系统语言切换为: {lang_name}',
        'set_lang_error': '切换系统语言失败: 错误: {error}',
        'list_folders': '读取文件夹列表（侧边栏树）',
        'list_folders_error': '读取文件夹列表失败: 错误: {error}',
        'get_item': '获取项目详情 (ID: {item_id}, 名称="{name}")',
        'get_item_error': '获取项目详情 (ID: {item_id}) 失败: 错误: {error}',
        
        # Banner elements
        'banner_title': '硬盘文件管理器 — Weiyang\'s Disk Explorer',
        'banner_status': '服务器状态: 正在运行 (Waitress 多线程)',
        'banner_address': '服务访问地址: http://127.0.0.1:5000',
        'banner_db': '数据库物理路径: {db_path}',
        'banner_db_status': '数据库状态: 连接正常 (启用 WAL 模式)',
        'banner_lang': '终端显示语言: {lang_name}',
        'banner_log_dir': '系统日志目录: {log_dir}',
        'banner_time': '系统启动时间: {startup_time}',
        'banner_intro': '本系统负责实时跟踪网页用户的操作，并以日为单位生成日志。',
        'db_added_size_column': '[OK] 已添加 file_size 列',
        'db_added_updated_column': '[OK] 已添加 updated_at 列',
        'db_index_ready': '[OK] 数据库索引已就绪',
        'db_init_error': '数据库初始化错误: {error}',
    },
    'en': {
        'list_root': 'List all files and folders in the root directory',
        'list_root_error': 'Failed to list root items: {error}',
        'list_folder': 'List all files and folders in the folder (Parent Folder ID: {parent_id})',
        'list_folder_error': 'Failed to list items in folder (Parent Folder ID: {parent_id}): {error}',
        'add_item': 'Create new item: Name="{name}", Type="{type}", Parent ID={parent_id}, Size="{file_size}", Location="{location}"',
        'add_item_error': 'Failed to create new item: Name="{name}", Type="{type}", Error: {error}',
        'edit_item': 'Modify item (ID: {item_id}): Name="{name}", Desc="{description}", Location="{location}", Format="{format_val}", Parent ID={parent_id}, Size="{file_size}"',
        'edit_item_error': 'Failed to modify item (ID: {item_id}): Error: {error}',
        'delete_item': 'Delete item (ID: {item_id}, cascade deleted {deleted_count} descendant items)',
        'delete_item_error': 'Failed to delete item (ID: {item_id}): Error: {error}',
        'search': 'Search items: Query="{query}", Fields={fields}',
        'search_error': 'Failed to search items: Query="{query}", Error: {error}',
        'stats': 'Retrieve system storage and format statistics',
        'stats_error': 'Failed to retrieve statistics: Error: {error}',
        'export': 'Export item data: Format="{format_type}", Scope="{scope}", Item ID={item_id}',
        'export_error': 'Failed to export item data: Error: {error}',
        'import': 'Import data: Successfully imported {imported} items',
        'import_error': 'Failed to import data: Error: {error}',
        'local_list': 'Browse local physical disk: Path="{path}"',
        'local_list_error': 'Failed to browse local physical disk: Path="{path}", Error: {error}',
        'local_resolve': 'Resolve and scan local physical paths: contains {folders_count} folders, {files_count} files',
        'local_resolve_error': 'Failed to resolve local physical paths: Error: {error}',
        'set_lang': 'Switch system language to: {lang_name}',
        'set_lang_error': 'Failed to switch system language: Error: {error}',
        'list_folders': 'Retrieve folder list (for sidebar tree)',
        'list_folders_error': 'Failed to retrieve folder list: Error: {error}',
        'get_item': 'Get item details (ID: {item_id}, Name="{name}")',
        'get_item_error': 'Failed to get item details (ID: {item_id}): Error: {error}',
        
        # Banner elements
        'banner_title': 'Disk File Manager — Weiyang\'s Disk Explorer',
        'banner_status': 'Server Status: RUNNING (Waitress Multi-threaded)',
        'banner_address': 'Server API Address: http://127.0.0.1:5000',
        'banner_db': 'Database Physical Path: {db_path}',
        'banner_db_status': 'Database Status: Connected (WAL Mode Enabled)',
        'banner_lang': 'Console Active Language: {lang_name}',
        'banner_log_dir': 'System Log Directory: {log_dir}',
        'banner_time': 'System Startup Time: {startup_time}',
        'banner_intro': 'This system tracks web client operations in real-time and separates logs daily.',
        'db_added_size_column': '[OK] Added file_size column',
        'db_added_updated_column': '[OK] Added updated_at column',
        'db_index_ready': '[OK] Database index ready',
        'db_init_error': 'Database initialization error: {error}',
    },
    'zh-TW': {
        'list_root': '列出根目錄下的所有檔案和資料夾',
        'list_root_error': '列出根目錄項目失敗: {error}',
        'list_folder': '列出資料夾下的所有檔案和資料夾 (父資料夾 ID: {parent_id})',
        'list_folder_error': '列出資料夾下的項目失敗 (父資料夾 ID: {parent_id}): {error}',
        'add_item': '新建項目: 名稱="{name}", 類型="{type}", 父目錄 ID={parent_id}, 檔案大小="{file_size}", 物理路徑="{location}"',
        'add_item_error': '新建項目失敗: 名稱="{name}", 類型="{type}", 錯誤: {error}',
        'edit_item': '修改項目 (ID: {item_id}): 名稱="{name}", 描述="{description}", 物理路徑="{location}", 格式="{format_val}", 父目錄 ID={parent_id}, 檔案大小="{file_size}"',
        'edit_item_error': '修改項目 (ID: {item_id}) 失敗: 錯誤: {error}',
        'delete_item': '刪除項目 (ID: {item_id}, 共級聯刪除 {deleted_count} 個子項目)',
        'delete_item_error': '刪除項目 (ID: {item_id}) 失敗: 錯誤: {error}',
        'search': '搜尋項目: 關鍵字="{query}", 搜尋維度={fields}',
        'search_error': '搜尋項目失敗: 關鍵字="{query}", 錯誤: {error}',
        'stats': '獲取系統儲存和檔案格式統計數據',
        'stats_error': '獲取系統統計數據失敗: 錯誤: {error}',
        'export': '匯出項目數據: 格式="{format_type}", 範圍="{scope}", 項目 ID={item_id}',
        'export_error': '匯出項目數據失敗: 錯誤: {error}',
        'import': '匯入數據: 成功匯入 {imported} 個項目',
        'import_error': '匯入數據失敗: 錯誤: {error}',
        'local_list': '瀏覽本地物理磁碟: 路徑="{path}"',
        'local_list_error': '瀏覽本地物理磁碟失敗: 路徑="{path}", 錯誤: {error}',
        'local_resolve': '解析並掃描本地物理路徑: 包含 {folders_count} 個資料夾，{files_count} 個檔案',
        'local_resolve_error': '解析本地物理路徑失敗: 錯誤: {error}',
        'set_lang': '將系統語言切換為: {lang_name}',
        'set_lang_error': '切換系統語言失敗: 錯誤: {error}',
        'list_folders': '讀取資料夾列表（側邊欄樹）',
        'list_folders_error': '讀取資料夾列表失敗: 錯誤: {error}',
        'get_item': '獲取項目詳情 (ID: {item_id}, 名稱="{name}")',
        'get_item_error': '獲取項目詳情 (ID: {item_id}) 失敗: 錯誤: {error}',
        
        # Banner elements
        'banner_title': '硬碟檔案管理器 — Weiyang\'s Disk Explorer',
        'banner_status': '伺服器狀態: 正在執行 (Waitress 多執行緒)',
        'banner_address': '服務存取地址: http://127.0.0.1:5000',
        'banner_db': '資料庫物理路徑: {db_path}',
        'banner_db_status': '資料庫狀態: 連線正常 (啟用 WAL 模式)',
        'banner_lang': '終端顯示語言: {lang_name}',
        'banner_log_dir': '系統日誌目錄: {log_dir}',
        'banner_time': '系統啟動時間: {startup_time}',
        'banner_intro': '本系統負責即時追蹤網頁使用者的操作，並以日為單位生成日誌。',
        'db_added_size_column': '[OK] 已新增 file_size 欄位',
        'db_added_updated_column': '[OK] 已新增 updated_at 欄位',
        'db_index_ready': '[OK] 資料庫索引已就緒',
        'db_init_error': '資料庫初始化錯誤: {error}',
    },
    'ja': {
        'list_root': 'ルートディレクトリのすべてのファイルとフォルダをリストする',
        'list_root_error': 'ルート項目の取得に失敗しました: {error}',
        'list_folder': 'フォルダ内のすべてのファイルとフォルダをリストする (フォルダ ID: {parent_id})',
        'list_folder_error': 'フォルダ内のアイテムのリストに失敗しました (フォルダ ID: {parent_id}): {error}',
        'add_item': '新規アイテム作成: 名前="{name}", タイプ="{type}", 親 ID={parent_id}, サイズ="{file_size}", パス="{location}"',
        'add_item_error': '新規アイテム作成に失敗しました: 名前="{name}", タイプ="{type}", エラー: {error}',
        'edit_item': 'アイテム編集 (ID: {item_id}): 名前="{name}", 説明="{description}", パス="{location}", 形式="{format_val}", 親 ID={parent_id}, サイズ="{file_size}"',
        'edit_item_error': 'アイテム編集 (ID: {item_id}) に失敗しました: エラー: {error}',
        'delete_item': 'アイテム削除 (ID: {item_id}, 計 {deleted_count} 個のサブ項目をカスケード削除)',
        'delete_item_error': 'アイテム削除 (ID: {item_id}) に失敗しました: エラー: {error}',
        'search': 'アイテム検索: キーワード="{query}", 検索範囲={fields}',
        'search_error': 'アイテム検索に失敗しました: キーワード="{query}", エラー: {error}',
        'stats': 'ストレージとファイル形式の統計情報を取得する',
        'stats_error': '統計情報の取得に失敗しました: エラー: {error}',
        'export': 'アイテムデータエクスポート: 形式="{format_type}", 範囲="{scope}", アイテム ID={item_id}',
        'export_error': 'アイテムデータのエクスポートに失敗しました: エラー: {error}',
        'import': 'データインポート: {imported} 個のアイテムを正常にインポートしました',
        'import_error': 'データのインポートに失敗しました: エラー: {error}',
        'local_list': 'ローカル物理ディスクを閲覧: パス="{path}"',
        'local_list_error': 'ローカル物理ディスクの閲覧に失敗しました: パス="{path}", エラー: {error}',
        'local_resolve': 'ローカル物理パスを解析・スキャン: {folders_count} 個のフォルダ、{files_count} 個のファイルを含む',
        'local_resolve_error': 'ローカル物理パスの解析に失敗しました: エラー: {error}',
        'set_lang': 'システム言語を切り替える: {lang_name}',
        'set_lang_error': 'システム言語の切り替えに失敗しました: エラー: {error}',
        'list_folders': 'フォルダリストを取得する（サイドバーツリー用）',
        'list_folders_error': 'フォルダリストの取得に失敗しました: エラー: {error}',
        'get_item': 'アイテム詳細を取得する (ID: {item_id}, 名前="{name}")',
        'get_item_error': 'アイテム詳細の取得に失敗しました (ID: {item_id}): エラー: {error}',
        
        # Banner elements
        'banner_title': 'ディスクファイル管理 — Weiyang\'s Disk Explorer',
        'banner_status': 'サーバー状況: 実行中 (Waitress マルチスレッド)',
        'banner_address': 'サービスアドレス: http://127.0.0.1:5000',
        'banner_db': 'データベース物理パス: {db_path}',
        'banner_db_status': 'データベース接続状況: 正常 (WALモード有効)',
        'banner_lang': 'コンソール表示言語: {lang_name}',
        'banner_log_dir': 'システムログディレクトリ: {log_dir}',
        'banner_time': 'システム起動時間: {startup_time}',
        'banner_intro': '本システムはウェブクライアントの操作をリアルタイムで追跡し、日次のログファイルを生成します。',
        'db_added_size_column': '[OK] file_size カラムを追加しました',
        'db_added_updated_column': '[OK] updated_at カラムを追加しました',
        'db_index_ready': '[OK] データベースインデックスの準備が完了しました',
        'db_init_error': 'データベース初期化エラー: {error}',
    }
}

def get_display_width(s):
    """Calculate the visual display width of a string with full-width characters."""
    clean_s = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', s)
    width = 0
    for char in clean_s:
        if ord(char) > 0x7F:
            width += 2
        else:
            width += 1
    return width

def pad_string(s, total_width, align='left'):
    """Pad string to ensure fixed visual width in the terminal."""
    curr_width = get_display_width(s)
    pad_needed = total_width - curr_width
    if pad_needed <= 0:
        return s
    
    if align == 'left':
        return s + ' ' * pad_needed
    elif align == 'right':
        return ' ' * pad_needed + s
    else: # center
        left_pad = pad_needed // 2
        right_pad = pad_needed - left_pad
        return ' ' * left_pad + s + ' ' * right_pad

def load_saved_language():
    global _active_lang
    if os.path.exists(LANG_FILE):
        try:
            with open(LANG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                lang = data.get('language')
                if lang in SUPPORTED_LANGS:
                    _active_lang = lang
        except Exception:
            pass
    return _active_lang

def save_language(lang):
    global _active_lang
    if lang in SUPPORTED_LANGS:
        _active_lang = lang
        try:
            with open(LANG_FILE, 'w', encoding='utf-8') as f:
                json.dump({'language': lang}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
        return True
    return False

def get_current_language():
    return _active_lang

def init_logger():
    # 1. Silence default Flask requests logger (werkzeug)
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.WARNING)
    
    # 2. Ensure log directory exists
    if not os.path.exists(LOG_DIR):
        try:
            os.makedirs(LOG_DIR)
        except Exception as e:
            print(f"[{C_RED}ERROR{C_RESET}] Failed to create log directory: {e}")
            
    # 3. Load active language
    load_saved_language()
    
    # 4. Print startup banner
    print_startup_banner()

def print_startup_banner():
    lang = _active_lang
    lang_name = LANG_NAMES.get(lang, LANG_NAMES['zh-CN'])
    db_path = os.path.join(BASE_DIR, 'python', 'file_manager.db')
    
    t_dict = TRANSLATIONS.get(lang, TRANSLATIONS['zh-CN'])
    banner_title = t_dict.get('banner_title', '')
    banner_status = t_dict.get('banner_status', '')
    banner_address = t_dict.get('banner_address', '')
    banner_db = t_dict.get('banner_db', '').format(db_path=db_path)
    banner_db_status = t_dict.get('banner_db_status', '')
    banner_lang = t_dict.get('banner_lang', '').format(lang_name=lang_name)
    banner_log_dir = t_dict.get('banner_log_dir', '').format(log_dir=LOG_DIR)
    banner_time = t_dict.get('banner_time', '').format(startup_time=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    banner_intro = t_dict.get('banner_intro', '')
    
    # Format status text colors if they are in the message
    db_status_display = banner_db_status
    if "连接正常" in db_status_display:
        db_status_display = db_status_display.replace("连接正常", f"{C_GREEN}连接正常{C_RESET}")
    elif "Connected" in db_status_display:
        db_status_display = db_status_display.replace("Connected", f"{C_GREEN}Connected{C_RESET}")
    elif "正常" in db_status_display:
        db_status_display = db_status_display.replace("正常", f"{C_GREEN}正常{C_RESET}")
        
    print(banner_title)
    print("-" * len(banner_title))
    print(banner_status)
    print(banner_address)
    print(banner_db)
    print(db_status_display)
    print(banner_lang)
    print(banner_log_dir)
    print(banner_time)
    print("-" * len(banner_title))
    print(banner_intro)
    print()

def print_db_message(key, **kwargs):
    lang = _active_lang
    t_dict = TRANSLATIONS.get(lang, TRANSLATIONS['zh-CN'])
    template = t_dict.get(key, key)
    try:
        print(template.format(**kwargs))
    except Exception:
        print(template)

def log_operation(ip, method, route, action_key, status_code, **kwargs):
    lang = _active_lang
    t_dict = TRANSLATIONS.get(lang, TRANSLATIONS['zh-CN'])
    
    # Get translation template
    template = t_dict.get(action_key, action_key)
    
    # Format description
    try:
        # Default placeholder values if missing
        kwargs.setdefault('parent_id', 'None')
        kwargs.setdefault('name', '')
        kwargs.setdefault('type', '')
        kwargs.setdefault('file_size', '')
        kwargs.setdefault('location', '')
        kwargs.setdefault('description', '')
        kwargs.setdefault('format_val', '')
        kwargs.setdefault('item_id', '')
        kwargs.setdefault('deleted_count', 0)
        kwargs.setdefault('query', '')
        kwargs.setdefault('fields', [])
        kwargs.setdefault('format_type', '')
        kwargs.setdefault('scope', '')
        kwargs.setdefault('imported', 0)
        kwargs.setdefault('path', '')
        kwargs.setdefault('folders_count', 0)
        kwargs.setdefault('files_count', 0)
        kwargs.setdefault('lang_name', '')
        kwargs.setdefault('error', 'Unknown Error')
        
        description = template.format(**kwargs)
    except Exception as e:
        description = f"{action_key} {kwargs} (Format error: {e})"
        
    now = datetime.now()
    timestamp_str = now.strftime('%Y-%m-%d %H:%M:%S')
    date_str = now.strftime('%Y-%m-%d')
    
    is_success = status_code < 400
    
    # Format status text and color
    if is_success:
        status_label = f"[{C_GREEN}SUCCESS{C_RESET}]"
        status_code_colored = f"{C_GREEN}{status_code}{C_RESET}"
    else:
        status_label = f"[{C_RED}ERROR{C_RESET}]"
        status_code_colored = f"{C_RED}{status_code}{C_RESET}"
        
    method_upper = method.upper()
    
    # Format terminal output (Plain White text except status)
    terminal_log = (
        f"[{timestamp_str}] "
        f"{status_label} "
        f"[{ip}] "
        f"[{lang.upper()}] "
        f"{method_upper:<6} "
        f"{route:<25} -> "
        f"{description} "
        f"(Status: {status_code_colored})"
    )
    
    print(terminal_log)
    
    # Format file log entry (plain text, no ANSI codes)
    log_file_path = os.path.join(LOG_DIR, f"{date_str}.log")
    clean_icon = "SUCCESS" if is_success else "ERROR"
    file_log_entry = f"[{timestamp_str}] [{clean_icon}] [{ip}] [{lang}] {method_upper} {route} -> {description} (Status: {status_code})\n"
    
    try:
        with open(log_file_path, 'a', encoding='utf-8') as f:
            f.write(file_log_entry)
    except Exception as e:
        print(f"[ERROR] Failed to write log file: {e}")
