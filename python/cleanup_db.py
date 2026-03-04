#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
清理数据库锁定文件
用于解决 SQLite WAL 文件残留导致的数据库锁定问题
"""

import os
import sys

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DB_DIR, 'file_manager.db')
DB_WAL = DB_PATH + '-wal'
DB_SHM = DB_PATH + '-shm'

def cleanup():
    """清理 SQLite WAL 和 SHM 文件"""
    files_removed = []
    
    # 删除 WAL 文件
    if os.path.exists(DB_WAL):
        try:
            os.remove(DB_WAL)
            files_removed.append(DB_WAL)
            print(f"✓ 已删除: {DB_WAL}")
        except Exception as e:
            print(f"✗ 删除失败 {DB_WAL}: {e}")
    
    # 删除 SHM 文件
    if os.path.exists(DB_SHM):
        try:
            os.remove(DB_SHM)
            files_removed.append(DB_SHM)
            print(f"✓ 已删除: {DB_SHM}")
        except Exception as e:
            print(f"✗ 删除失败 {DB_SHM}: {e}")
    
    if not files_removed:
        print("ℹ 没有需要清理的文件")
    else:
        print(f"\n✓ 清理完成，共删除 {len(files_removed)} 个文件")
        print("\n现在可以重新启动 main.py 了。")

if __name__ == '__main__':
    print("="*50)
    print("SQLite 数据库清理工具")
    print("="*50)
    print(f"数据库路径: {DB_PATH}")
    print()
    cleanup()
