# ================================
# main.py (Python 3.14 compatible)
# ================================

# ---- Compatibility Patch for Python 3.14 ----
import pkgutil
if not hasattr(pkgutil, "get_loader"):
    import importlib.util
    import sys
    def get_loader(name):
        try:
            # Handle __main__ module specially
            if name == "__main__":
                return sys.modules.get("__main__").__loader__ if "__main__" in sys.modules else None
            spec = importlib.util.find_spec(name)
            return spec.loader if spec else None
        except (ValueError, ImportError, AttributeError):
            return None
    pkgutil.get_loader = get_loader

# ---- Flask App ----
from flask import Flask, jsonify, request, make_response
from flask_cors import CORS
import sqlite3
import os
import re
from datetime import datetime

app = Flask(__name__, static_folder='../', static_url_path='/')
CORS(app)

# 数据库路径
DB_PATH = os.path.join(os.path.dirname(__file__), 'file_manager.db')

# 获取数据库连接（改进版）
def get_db_connection():
    """获取数据库连接，配置超时和其他参数以防止锁定"""
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    # 不使用 isolation_level=None（autocommit），保留 Python sqlite3 默认事务管理，
    # 使 rollback() 在异常时能真正回滚。import_data() 中使用显式 BEGIN。
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

# 初始化数据库
def init_db():
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        description TEXT,
                        location TEXT,
                        format TEXT,
                        type TEXT NOT NULL,
                        parent_id INTEGER,
                        file_size TEXT
                    )''')
        # Auto-add file_size column to existing tables
        try:
            c.execute("SELECT file_size FROM items LIMIT 1")
        except sqlite3.OperationalError:
            c.execute("ALTER TABLE items ADD COLUMN file_size TEXT")
            print("✓ Added file_size column")
        # ---- 性能索引 ----
        c.execute("CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_items_name ON items(name)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_items_format ON items(format)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_items_location ON items(location)")
        print("✓ 数据库索引已就绪")
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"数据库初始化错误: {e}")

init_db()

# 获取项目（支持 parent_id 过滤 + 分页 + 排序）
@app.route('/api/items', methods=['GET'])
def get_items():
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()

        # —— 分页参数 ——
        try:
            page  = max(1, int(request.args.get('page', 1)))
            limit = min(max(1, int(request.args.get('limit', 200))), 1000)
        except (TypeError, ValueError):
            page, limit = 1, 200

        # —— 排序参数（白名单，防 SQL 注入）——
        valid_sorts = {'name', 'type', 'format', 'file_size', 'location', 'description', 'id'}
        sort  = request.args.get('sort', 'name')
        order = request.args.get('order', 'asc').lower()
        if sort  not in valid_sorts: sort  = 'name'
        if order not in ('asc', 'desc'): order = 'asc'

        # —— parent_id 过滤 ——
        parent_id_raw = request.args.get('parent_id', '__all__')
        if parent_id_raw == '__all__':
            where_clause = ''
            where_params = []
        elif parent_id_raw in ('null', 'None', '', 'root'):
            where_clause = 'WHERE parent_id IS NULL'
            where_params = []
        else:
            try:
                pid = int(parent_id_raw)
                where_clause = 'WHERE parent_id = ?'
                where_params = [pid]
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid parent_id"}), 400

        # —— 获取总数 ——
        c.execute(f"SELECT COUNT(*) FROM items {where_clause}", where_params)
        total = c.fetchone()[0]
        total_pages = max(1, (total + limit - 1) // limit)
        offset = (page - 1) * limit

        # —— 查询（文件夹优先排序）——
        sql = f"""
            SELECT id, name, description, location, format, type, parent_id, file_size
            FROM items {where_clause}
            ORDER BY CASE WHEN type='folder' THEN 0 ELSE 1 END ASC,
                     {sort} {order}
            LIMIT ? OFFSET ?"""
        c.execute(sql, where_params + [limit, offset])
        rows = c.fetchall()
        items = [
            {"id": r[0], "name": r[1], "description": r[2], "location": r[3],
             "format": r[4], "type": r[5], "parent_id": r[6], "file_size": r[7]}
            for r in rows
        ]
        return jsonify({
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
            "has_next": page < total_pages
        })
    except Exception as e:
        print(f"获取项目错误: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


# 获取所有文件夹（轻量，用于侧边栏树）
@app.route('/api/folders', methods=['GET'])
def get_folders():
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id, name, parent_id FROM items WHERE type='folder' ORDER BY name ASC")
        rows = c.fetchall()
        folders = [{"id": r[0], "name": r[1], "parent_id": r[2], "type": "folder"} for r in rows]
        return jsonify(folders)
    except Exception as e:
        print(f"获取文件夹错误: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 获取单个项目详情
@app.route('/api/items/<int:item_id>', methods=['GET'])
def get_item(item_id):
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id, name, description, location, format, type, parent_id, file_size FROM items WHERE id = ?", (item_id,))
        row = c.fetchone()
        if row:
            return jsonify({
                "id": row[0], "name": row[1], "description": row[2],
                "location": row[3], "format": row[4], "type": row[5],
                "parent_id": row[6], "file_size": row[7]
            })
        return jsonify({"error": "Item not found"}), 404
    except Exception as e:
        print(f"获取项目详情错误: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 添加文件或文件夹
@app.route('/api/items', methods=['POST'])
def add_item():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400
    if not isinstance(data, dict):
        return jsonify({"error": "Expected JSON object"}), 400
    required_fields = ["name", "type"]
    if not all(field in data and data[field] for field in required_fields):
        return jsonify({"error": "Missing required fields"}), 400
    if data.get('type') not in ('file', 'folder'):
        return jsonify({"error": "Invalid type, must be 'file' or 'folder'"}), 400
    # Defensive: sanitize name
    name = str(data.get('name', '')).strip()
    if not name:
        return jsonify({"error": "Name cannot be empty"}), 400
    # Validate parent_id if provided
    parent_id = data.get('parent_id')
    if parent_id is not None:
        try:
            parent_id = int(parent_id)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid parent_id"}), 400

    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute('''INSERT INTO items (name, description, location, format, type, parent_id, file_size)
                     VALUES (?, ?, ?, ?, ?, ?, ?)''',
                  (name,
                   data.get('description'),
                   data.get('location'),
                   data.get('format'),
                   data.get('type'),
                   parent_id,
                   data.get('file_size')))
        conn.commit()
        new_id = c.lastrowid
        return jsonify({"message": "Item added successfully", "id": new_id})
    except Exception as e:
        print(f"添加项目错误: {e}")
        if conn:
            conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 编辑项目（支持部分更新）
@app.route('/api/items/<int:item_id>', methods=['PUT'])
def edit_item(item_id):
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400
    if not isinstance(data, dict):
        return jsonify({"error": "Expected JSON object"}), 400
    # 验证 type 字段（如果提供了的话）
    if 'type' in data and data['type'] not in ('file', 'folder'):
        return jsonify({"error": "Invalid type, must be 'file' or 'folder'"}), 400
    # 验证 name 不为空白（如果提供了的话）
    if 'name' in data:
        name_val = str(data['name']).strip() if data['name'] else ''
        if not name_val:
            return jsonify({"error": "Name cannot be empty"}), 400
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        
        # 首先获取现有数据
        c.execute('SELECT name, description, location, format, parent_id, file_size FROM items WHERE id=?', (item_id,))
        existing = c.fetchone()
        
        if not existing:
            return jsonify({"error": "Item not found"}), 404
        
        name = data.get('name', existing[0])
        description = data.get('description', existing[1])
        location = data.get('location', existing[2])
        format_value = data.get('format', existing[3])
        parent_id = data.get('parent_id') if 'parent_id' in data else existing[4]
        file_size = data.get('file_size') if 'file_size' in data else existing[5]
        
        # 检查循环引用：不允许将项目移到自己的后代下
        if parent_id is not None and parent_id != existing[4]:
            ancestor = parent_id
            while ancestor is not None:
                if ancestor == item_id:
                    return jsonify({"error": "Cannot move item under its own descendant (circular reference)"}), 400
                c.execute("SELECT parent_id FROM items WHERE id=?", (ancestor,))
                row = c.fetchone()
                ancestor = row[0] if row else None
        
        c.execute('''UPDATE items SET name=?, description=?, location=?, format=?, parent_id=?, file_size=?
                     WHERE id=?''',
                  (name, description, location, format_value, parent_id, file_size, item_id))
        conn.commit()
        return jsonify({"message": "Item updated successfully"})
    except Exception as e:
        print(f"编辑项目错误: {e}")
        if conn:
            conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 递归获取所有子项ID（包括所有后代）
def get_all_descendants(item_id, conn):
    """递归获取指定项目的所有后代ID"""
    c = conn.cursor()
    descendants = [item_id]
    to_process = [item_id]
    
    while to_process:
        current_id = to_process.pop(0)
        c.execute("SELECT id FROM items WHERE parent_id=?", (current_id,))
        children = c.fetchall()
        for child in children:
            child_id = child[0]
            descendants.append(child_id)
            to_process.append(child_id)
    
    return descendants

# 删除项目
@app.route('/api/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        
        # 检查项目是否存在
        c.execute("SELECT id FROM items WHERE id=?", (item_id,))
        if not c.fetchone():
            return jsonify({"error": "Item not found"}), 404
        
        # 获取所有需要删除的项目（包括所有后代）
        all_ids = get_all_descendants(item_id, conn)
        
        # 批量删除所有项目
        if len(all_ids) > 0:
            placeholders = ','.join('?' * len(all_ids))
            c.execute(f"DELETE FROM items WHERE id IN ({placeholders})", all_ids)
        
        conn.commit()
        return jsonify({
            "message": "Item deleted successfully",
            "deleted_count": len(all_ids)
        })
    except Exception as e:
        print(f"删除项目错误: {e}")
        if conn:
            conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 搜索项目
@app.route('/api/search', methods=['GET'])
def search_items():
    query = request.args.get('q', '')
    try:
        page  = max(1, int(request.args.get('page', 1)))
        limit = min(max(1, int(request.args.get('limit', 200))), 500)
    except (TypeError, ValueError):
        page, limit = 1, 200
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        # 转义 LIKE 通配符
        escaped_query = query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        like_pattern = f'%{escaped_query}%'
        # 先查总数
        c.execute('''SELECT COUNT(*) FROM items
                     WHERE name LIKE ? ESCAPE '\\'
                        OR description LIKE ? ESCAPE '\\'
                        OR format LIKE ? ESCAPE '\\'
                        OR location LIKE ? ESCAPE '\\' ''',
                  (like_pattern, like_pattern, like_pattern, like_pattern))
        total = c.fetchone()[0]
        total_pages = max(1, (total + limit - 1) // limit)
        offset = (page - 1) * limit
        c.execute('''SELECT id, name, description, location, format, type, parent_id, file_size
                     FROM items
                     WHERE name LIKE ? ESCAPE '\\'
                        OR description LIKE ? ESCAPE '\\'
                        OR format LIKE ? ESCAPE '\\'
                        OR location LIKE ? ESCAPE '\\'
                     ORDER BY
                       CASE WHEN name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END ASC,
                       CASE WHEN type='folder' THEN 0 ELSE 1 END ASC,
                       name ASC
                     LIMIT ? OFFSET ?''',
                  (like_pattern, like_pattern, like_pattern, like_pattern, like_pattern, limit, offset))
        rows = c.fetchall()
        results = [
            {"id": r[0], "name": r[1], "description": r[2],
             "location": r[3], "format": r[4], "type": r[5],
             "parent_id": r[6], "file_size": r[7]}
            for r in rows
        ]
        return jsonify({"items": results, "total": total, "page": page, "total_pages": total_pages})
    except Exception as e:
        print(f"搜索错误: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 统计信息
@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        
        # 统计文件和文件夹数量
        c.execute("SELECT COUNT(*) FROM items WHERE type='file'")
        total_files = c.fetchone()[0]
        
        c.execute("SELECT COUNT(*) FROM items WHERE type='folder'")
        total_folders = c.fetchone()[0]
        
        c.execute("SELECT format, COUNT(*) FROM items WHERE type='file' AND format IS NOT NULL GROUP BY format ORDER BY COUNT(*) DESC")
        by_format = {row[0]: row[1] for row in c.fetchall()}
        
        # File size statistics（批量读取避免反复查询）
        c.execute("""
            SELECT file_size, format
            FROM items
            WHERE type='file'
              AND file_size IS NOT NULL
              AND file_size != ''
        """)
        total_size_bytes = 0
        sized_count = 0
        size_by_format = {}
        for (raw_size, fmt) in c.fetchall():
            parsed = parse_file_size(raw_size)
            if parsed > 0:
                total_size_bytes += parsed
                sized_count += 1
                if fmt:
                    size_by_format[fmt] = size_by_format.get(fmt, 0) + parsed
        
        c.execute("SELECT id, name, type, format FROM items ORDER BY id DESC LIMIT 5")
        recent = [{"id": r[0], "name": r[1], "type": r[2], "format": r[3]} for r in c.fetchall()]
        
        return jsonify({
            "total_files": total_files,
            "total_folders": total_folders,
            "total_items": total_files + total_folders,
            "by_format": by_format,
            "total_size_bytes": total_size_bytes,
            "total_size_display": format_size_display(total_size_bytes),
            "sized_file_count": sized_count,
            "size_by_format": {k: {"bytes": v, "display": format_size_display(v)} for k, v in sorted(size_by_format.items(), key=lambda x: x[1], reverse=True)},
            "recent_items": recent
        })
    except Exception as e:
        print(f"统计错误: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

def parse_file_size(raw):
    """Parse file size string to bytes, supports KB/MB/GB/TB"""
    if not raw:
        return 0
    raw = str(raw).strip()
    try:
        return int(float(raw))
    except (ValueError, TypeError):
        pass
    match = re.match(r'^([\d.,]+)\s*(B|KB|MB|GB|TB|BYTES?)$', raw, re.IGNORECASE)
    if not match:
        return 0
    num_str = match.group(1).replace(',', '')
    unit = match.group(2).upper()
    try:
        num = float(num_str)
    except ValueError:
        return 0
    multipliers = {'B': 1, 'BYTE': 1, 'BYTES': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4}
    return int(num * multipliers.get(unit, 1))

def format_size_display(size_bytes):
    if size_bytes <= 0:
        return "0 B"
    units = ['B', 'KB', 'MB', 'GB', 'TB']
    idx = 0
    size = float(size_bytes)
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    return f"{size:.2f} {units[idx]}" if idx > 0 else f"{int(size)} B"

def _build_export_response(items, format_type, filename_base):
    """构建导出文件响应（JSON 或 CSV）"""
    if format_type == 'csv':
        import io, csv
        output = io.StringIO()
        output.write('\ufeff')  # UTF-8 BOM
        writer = csv.DictWriter(output, fieldnames=['id', 'name', 'description', 'location', 'format', 'type', 'parent_id', 'file_size'])
        writer.writeheader()
        writer.writerows(items)
        response = make_response(output.getvalue())
        response.headers["Content-Disposition"] = f"attachment; filename={filename_base}.csv"
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        return response
    else:
        response = make_response(jsonify(items))
        response.headers["Content-Disposition"] = f"attachment; filename={filename_base}.json"
        return response

# 导出数据（支持 scope: all / folder / item，以及 POST 自选导出）
@app.route('/api/export', methods=['GET', 'POST'])
def export_data():
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()

        # POST：自选导出（收到 ids 列表）
        if request.method == 'POST':
            data = request.get_json(silent=True) or {}
            format_type = data.get('format', 'json')
            raw_ids = data.get('ids', [])

            # 防呆：验证 ids 为非空整数列表
            if not isinstance(raw_ids, list) or len(raw_ids) == 0:
                return jsonify({"error": "请选择至少一个项目"}), 400

            valid_ids = []
            for rid in raw_ids:
                try:
                    valid_ids.append(int(rid))
                except (TypeError, ValueError):
                    continue
            if not valid_ids:
                return jsonify({"error": "无有效的项目 ID"}), 400

            # 去重
            valid_ids = list(set(valid_ids))
            placeholders = ','.join('?' * len(valid_ids))
            c.execute(f"SELECT id, name, description, location, format, type, parent_id, file_size FROM items WHERE id IN ({placeholders})", valid_ids)
            rows = c.fetchall()
            if not rows:
                return jsonify({"error": "未找到任何匹配项目"}), 404

            items = []
            for row in rows:
                items.append({
                    "id": row[0], "name": row[1], "description": row[2],
                    "location": row[3], "format": row[4], "type": row[5],
                    "parent_id": row[6], "file_size": row[7]
                })

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename_base = f"disk_data_pick_{len(items)}items_{timestamp}"
            return _build_export_response(items, format_type, filename_base)

        # GET：原有逻辑
        format_type = request.args.get('format', 'json')
        scope = request.args.get('scope', 'all')
        item_id_raw = request.args.get('item_id')

        # 根据 scope 决定导出范围
        if scope in ('folder', 'item') and item_id_raw:
            try:
                target_id = int(item_id_raw)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid item_id"}), 400

            # 获取目标项目及其所有后代
            all_ids = get_all_descendants(target_id, conn)
            if scope == 'folder':
                # folder scope: 只导出该文件夹下的直接子项 + 所有后代
                # 包含文件夹本身
                pass  # all_ids 已包含目标及后代

            if not all_ids:
                return jsonify({"error": "Item not found"}), 404

            placeholders = ','.join('?' * len(all_ids))
            c.execute(f"SELECT id, name, description, location, format, type, parent_id, file_size FROM items WHERE id IN ({placeholders})", all_ids)
        else:
            c.execute("SELECT id, name, description, location, format, type, parent_id, file_size FROM items")

        rows = c.fetchall()
        items = []
        for row in rows:
            items.append({
                "id": row[0], "name": row[1], "description": row[2],
                "location": row[3], "format": row[4], "type": row[5],
                "parent_id": row[6], "file_size": row[7]
            })
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        scope_label = 'all' if scope == 'all' else f'{scope}_{item_id_raw}'
        filename_base = f"disk_data_{scope_label}_{timestamp}"
        return _build_export_response(items, format_type, filename_base)
    except Exception as e:
        print(f"导出错误: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

# 导入数据
@app.route('/api/import', methods=['POST'])
def import_data():
    data = request.get_json()
    
    if not isinstance(data, list):
        return jsonify({"error": "Invalid data format"}), 400
    
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        # 使用显式事务（标准事务管理，不依赖 autocommit）
        c.execute('BEGIN')

        # 准备数据并建立旧 ID 与新 ID 的映射
        remaining = []
        for raw in data:
            item_id = raw.get('id')
            parent_id = raw.get('parent_id')
            try:
                item_id = int(item_id) if item_id is not None else None
            except (TypeError, ValueError):
                item_id = None
            try:
                parent_id = int(parent_id) if parent_id is not None else None
            except (TypeError, ValueError):
                parent_id = None

            remaining.append({
                'old_id': item_id,
                'name': raw.get('name'),
                'description': raw.get('description'),
                'location': raw.get('location'),
                'format': raw.get('format'),
                'type': raw.get('type'),
                'old_parent_id': parent_id,
                'file_size': raw.get('file_size')
            })

        old_to_new = {}
        inserted_count = 0

        while remaining:
            progressed = False
            for entry in remaining[:]:
                parent_old_id = entry['old_parent_id']
                if parent_old_id is None or parent_old_id in old_to_new:
                    parent_new_id = old_to_new.get(parent_old_id)
                    c.execute('''INSERT INTO items (name, description, location, format, type, parent_id, file_size)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)''',
                              (entry['name'],
                               entry['description'],
                               entry['location'],
                               entry['format'],
                               entry['type'],
                               parent_new_id,
                               entry.get('file_size')))
                    new_id = c.lastrowid
                    if entry['old_id'] is not None:
                        old_to_new[entry['old_id']] = new_id
                    remaining.remove(entry)
                    inserted_count += 1
                    progressed = True

            if not progressed:
                # 剩余项目的 parent_id 在导入数据中找不到，
                # 将其挂载到根目录（parent_id=None）而不是整体失败
                for entry in remaining[:]:
                    c.execute('''INSERT INTO items (name, description, location, format, type, parent_id, file_size)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)''',
                              (entry['name'], entry['description'], entry['location'],
                               entry['format'], entry['type'], None, entry.get('file_size')))
                    new_id = c.lastrowid
                    if entry['old_id'] is not None:
                        old_to_new[entry['old_id']] = new_id
                    remaining.remove(entry)
                    inserted_count += 1
                    progressed = True
        
        conn.commit()
        return jsonify({"message": "Import successful", "imported": inserted_count})
    except Exception as e:
        print(f"导入错误: {e}")
        if conn:
            conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    try:
        from waitress import serve
        print("="*52)
        print(" 硬盘文件管理器 — Waitress 多线程服务")
        print(" http://127.0.0.1:5000")
        print("="*52)
        serve(app, host='127.0.0.1', port=5000, threads=8)
    except ImportError:
        print("⚠ waitress 未安装，回退到 Flask 开发服务器")
        print("⚠ 建议在虚拟环境中运行: pip install waitress")
        app.run(debug=False, host='127.0.0.1', port=5000, threaded=True)

