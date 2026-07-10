// ===================================
// 硬盘文件管理器 - Windows 风格（完整增强版）
// ===================================

const API_ROOT = 'http://127.0.0.1:5000/api';

// ===================================
// 语言切换与国际化
// ===================================
let activeLang = localStorage.getItem('disk_lang') || 'zh-CN';

// Patch window.fetch to automatically include language header
const originalFetch = window.fetch;
window.fetch = async function(resource, options = {}) {
  options.headers = options.headers || {};
  options.headers['X-Language'] = activeLang;
  return originalFetch(resource, options);
};

function t(key, ...args) {
  if (typeof TRANSLATIONS === 'undefined') return key;
  const langDict = TRANSLATIONS[activeLang] || TRANSLATIONS['zh-CN'];
  let val = langDict[key] !== undefined ? langDict[key] : (TRANSLATIONS['zh-CN'][key] !== undefined ? TRANSLATIONS['zh-CN'][key] : key);
  if (args.length > 0) {
    args.forEach((arg, index) => {
      val = val.replace(new RegExp(`\\{${index}\\}`, 'g'), arg);
    });
  }
  return val;
}

function setLanguage(lang) {
  if (typeof TRANSLATIONS === 'undefined' || !TRANSLATIONS[lang]) return;
  activeLang = lang;
  localStorage.setItem('disk_lang', lang);

  // Notify backend of language change
  fetch(`${API_ROOT}/set_lang?lang=${lang}`).catch(err => console.error("Failed to notify backend of language change:", err));

  // 1. 翻译静态 DOM 属性
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const translation = t(key);
    if (translation) {
      const textNode = Array.from(el.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (textNode) {
        textNode.nodeValue = translation;
      } else {
        const spanNode = el.querySelector('span');
        if (spanNode) {
          spanNode.textContent = translation;
        } else {
          el.textContent = translation;
        }
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = t(key);
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    el.title = t(key);
  });

  // 2. 翻译网页 Title
  document.title = t('appName');

  // 3. 更新 UI
  updateLanguageDropdownActiveState();
  updateBreadcrumb();
  
  // 重新加载统计面板（因为包含了需要翻译的数据）
  updateStats().catch(err => console.error(err));

  // 刷新当前面包屑与搜索框输入提示
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.placeholder = t('searchPlaceholder');
  
  // 刷新当前文件夹详情渲染
  if (selectedItem) {
    showItemDetails(selectedItem);
  }
}

function updateLanguageDropdownActiveState() {
  document.querySelectorAll('.lang-option').forEach(el => {
    if (el.dataset.lang === activeLang) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

// ===================================
// 全局状态
// ===================================
let currentFolder = null;
let allItems = [];          // 向后兼容保留（实际上只存 allFolders）
let allFolders = [];        // 所有文件夹（从 /api/folders 获取，轻量）
let itemCache = new Map();  // Map<parentId|null, {items:[...], total:N, page:N, total_pages:N}>
let selectedItem = null;
let viewMode = 'list';
let navigationHistory = [];
let historyIndex = -1;
let contextMenuItem = null;
let expandedFolderIds = new Set(['root']);
let localImportTargetFolder = null; // 批量导入的目标文件夹

// 分页状态（当前文件夹视图）
const PAGE_LIMIT = 200;
let currentViewPage        = 1;
let currentViewTotal       = 0;
let currentViewTotalPages  = 1;
// 搜索分页状态
let isSearchActive          = false;
let currentSearchQuery      = '';
let currentSearchPage       = 1;
let currentSearchTotalPages = 1;
let localImportState = {
  directoryFiles: [],
  looseFiles: [],
  directoryKeys: new Set(),
  looseKeys: new Set(),
  fsFolders: new Map(),
  fsFiles: new Map()
};
let localImportModalInstance = null;
let isProcessingLocalImport = false;
let isProcessingOperation = false; // 防止操作重叠的全局锁

// ===================================
// 初始化
// ===================================
document.addEventListener('DOMContentLoaded', () => {
  initializeUI();
  loadAllData();
  createContextMenu();
  setupContextMenuHandlers();
  initAddressBar();
  setLanguage(activeLang); // 初始化语言
});

function initializeUI() {
  document.getElementById('backBtn').addEventListener('click', navigateBack);
  document.getElementById('forwardBtn').addEventListener('click', navigateForward);
  document.getElementById('upBtn').addEventListener('click', navigateUp);
  document.getElementById('refreshBtn').addEventListener('click', () => loadAllData());
  
  document.getElementById('viewGridBtn').addEventListener('click', () => switchView('grid'));
  document.getElementById('viewListBtn').addEventListener('click', () => switchView('list'));
  
  document.getElementById('searchInput').addEventListener('input', handleSearch);
  
  // 绑定搜索筛选框变更事件
  document.querySelectorAll('#searchFilters input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value.trim()) {
        triggerSearch(searchInput.value, true);
      }
    });
  });
  
  // 绑定高级搜索面板展开折叠事件
  const filterBtn = document.getElementById('searchFilterBtn');
  const filtersDropdown = document.getElementById('searchFilters');
  if (filterBtn && filtersDropdown) {
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      filtersDropdown.classList.toggle('show');
      filterBtn.classList.toggle('active');
    });
    
    document.addEventListener('click', (e) => {
      if (!filtersDropdown.contains(e.target) && e.target !== filterBtn && !filterBtn.contains(e.target)) {
        filtersDropdown.classList.remove('show');
        filterBtn.classList.remove('active');
      }
    });
  }
  
  document.getElementById('newFolderBtn').addEventListener('click', () => openModal('folder'));
  document.getElementById('newFileBtn').addEventListener('click', () => openModal('file'));
  document.getElementById('deleteBtn').addEventListener('click', deleteItem);
  document.getElementById('emptyNewBtn').addEventListener('click', () => openModal('folder'));
  
  // 导出选项（事件委托）
  document.querySelectorAll('.export-option').forEach(el => {
    el.addEventListener('click', handleExportClick);
  });
  // 自选导出 — 打开选择弹窗
  const pickJsonBtn = document.getElementById('exportPickJson');
  const pickCsvBtn = document.getElementById('exportPickCsv');
  if (pickJsonBtn) pickJsonBtn.addEventListener('click', (e) => { e.preventDefault(); openExportPickModal('json'); });
  if (pickCsvBtn) pickCsvBtn.addEventListener('click', (e) => { e.preventDefault(); openExportPickModal('csv'); });
  document.getElementById('importBtn').addEventListener('click', () => {
    const modal = new bootstrap.Modal(document.getElementById('importModal'));
    modal.show();
  });
  document.getElementById('confirmImportBtn').addEventListener('click', importData);
  
  document.getElementById('itemForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('closePanelBtn').addEventListener('click', closeDetailsPanel);
  
  // 为 textarea 添加自动增高功能
  const descTextarea = document.getElementById('itemDesc');
  descTextarea.addEventListener('input', function() {
    autoResizeTextarea(this);
  });
  descTextarea.addEventListener('change', function() {
    autoResizeTextarea(this);
  });
  
  // 为模态框添加显示事件监听
  const itemModal = document.getElementById('itemModal');
  itemModal.addEventListener('shown.bs.modal', function() {
    // 模态框完全显示后调整 textarea 高度
    autoResizeTextarea(document.getElementById('itemDesc'));
  });

  // 键盘快捷键
  document.addEventListener('keydown', handleKeyboardShortcuts);

  // 点击内容区空白处取消选中
  document.getElementById('fileList').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeDetailsPanel();
    }
  });
  document.getElementById('fileGrid').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      closeDetailsPanel();
    }
  });

  document.getElementById('localImportBtn').addEventListener('click', openLocalImportModal);
  document.getElementById('localImportSelectCombinedBtn').addEventListener('click', () => {
    openLocalPickerModal();
  });
  document.getElementById('localImportResetBtn').addEventListener('click', () => resetLocalImportUI(true));
  document.getElementById('localImportStartBtn').addEventListener('click', startLocalImport);

  // 本地磁盘浏览器事件绑定
  document.getElementById('localPickerUpBtn').addEventListener('click', (e) => {
    const parentPath = e.currentTarget.dataset.parent || '';
    loadLocalPickerDirectory(parentPath);
  });
  document.getElementById('localPickerPathInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadLocalPickerDirectory(e.target.value.trim());
    }
  });
  document.getElementById('localPickerConfirmBtn').addEventListener('click', () => {
    handleLocalPickerConfirm();
  });
  const pickerSelectAllCheckbox = document.getElementById('localPickerSelectAll');
  if (pickerSelectAllCheckbox) {
    pickerSelectAllCheckbox.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.local-picker-item-checkbox').forEach(cb => {
        cb.checked = checked;
      });
      updateLocalPickerSelectionCount();
    });
  }
  
  const importModalEl = document.getElementById('localImportModal');
  if (importModalEl) {
    importModalEl.addEventListener('hidden.bs.modal', () => resetLocalImportUI(true));
    importModalEl.addEventListener('dragover', (e) => {
      if (isExternalDrag(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const modalContent = importModalEl.querySelector('.modal-content');
        if (modalContent) modalContent.classList.add('drag-over');
      }
    });
    importModalEl.addEventListener('dragleave', (e) => {
      const modalContent = importModalEl.querySelector('.modal-content');
      if (modalContent && (e.relatedTarget === null || !modalContent.contains(e.relatedTarget))) {
        modalContent.classList.remove('drag-over');
      }
    });
    importModalEl.addEventListener('drop', (e) => {
      if (isExternalDrag(e)) {
        const modalContent = importModalEl.querySelector('.modal-content');
        if (modalContent) modalContent.classList.remove('drag-over');
        handleExternalDrop(e, localImportTargetFolder || currentFolder, true);
      }
    });
  }

  // 绑定语言选择
  document.querySelectorAll('.lang-option').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const lang = e.currentTarget.dataset.lang;
      setLanguage(lang);
    });
  });

  // 绑定全局外部文件拖拽到主内容区
  const contentArea = document.querySelector('.content-area');
  if (contentArea) {
    contentArea.addEventListener('dragover', (e) => {
      if (isExternalDrag(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        contentArea.classList.add('drag-over');
      }
    });
    contentArea.addEventListener('dragleave', (e) => {
      if (e.relatedTarget === null || !contentArea.contains(e.relatedTarget)) {
        contentArea.classList.remove('drag-over');
      }
    });
    contentArea.addEventListener('drop', (e) => {
      if (isExternalDrag(e)) {
        contentArea.classList.remove('drag-over');
        handleExternalDrop(e, currentFolder);
      }
    });
  }

  // 阻止浏览器默认的拖放打开文件行为
  window.addEventListener('dragover', (e) => {
    if (isExternalDrag(e)) {
      e.preventDefault();
    }
  }, false);
  window.addEventListener('drop', (e) => {
    if (isExternalDrag(e)) {
      e.preventDefault();
    }
  }, false);

  // 侧边栏拖拽调整
  initSidebarResize();
}

// ===================================
// 可编辑地址栏
// ===================================
function initAddressBar() {
  const addressBar = document.getElementById('addressBar');
  const breadcrumb = document.getElementById('breadcrumb');
  const addressInput = document.getElementById('addressInput');

  if (!addressBar || !breadcrumb || !addressInput) return;

  // 点击地址栏切换到输入模式
  breadcrumb.addEventListener('click', function(e) {
    // 如果点击的是面包屑项，让它们正常处理
    if (e.target.closest('.breadcrumb-item')) return;
    enterAddressInputMode();
  });

  // 按 Enter 导航
  addressInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const path = this.value.trim();
      if (path) {
        navigateByPathInput(path);
      }
      exitAddressInputMode();
    } else if (e.key === 'Escape') {
      exitAddressInputMode();
    }
  });

  // 失焦时退出编辑模式
  addressInput.addEventListener('blur', function() {
    exitAddressInputMode();
  });

  // 允许点击地址栏空白处（非输入框）重新进入编辑
  addressBar.addEventListener('click', function(e) {
    if (e.target === addressBar || e.target.closest('.address-bar') === addressBar) {
      if (addressInput.style.display !== 'block') {
        enterAddressInputMode();
      }
    }
  });
}

function getCurrentPathString() {
  // 构建当前路径字符串：此电脑/文件夹1/文件夹2
  const segments = ['此电脑'];
  let current = currentFolder;
  const tempPath = [];
  while (current) {
    tempPath.unshift(current.name);
    current = current.parent_id ? allFolders.find(i => i.id === current.parent_id) : null;
  }
  segments.push(...tempPath);
  return segments.join('/');
}

function enterAddressInputMode() {
  const breadcrumb = document.getElementById('breadcrumb');
  const addressInput = document.getElementById('addressInput');
  if (!breadcrumb || !addressInput) return;

  breadcrumb.style.display = 'none';
  addressInput.style.display = 'block';
  addressInput.value = getCurrentPathString();
  addressInput.focus();
  addressInput.select();
}

function exitAddressInputMode() {
  const breadcrumb = document.getElementById('breadcrumb');
  const addressInput = document.getElementById('addressInput');
  if (!breadcrumb || !addressInput) return;

  addressInput.style.display = 'none';
  breadcrumb.style.display = 'flex';
}

function navigateByPathInput(pathStr) {
  // 用户输入的路径格式: "此电脑/文件夹1/文件夹2"
  // 或者 "文件夹1/文件夹2"
  // 如果输入是 "此电脑" 或 "根目录" 等，导航到根
  let cleaned = pathStr.trim();
  
  // 处理 "此电脑" 作为根目录
  if (cleaned === '此电脑' || cleaned === '根目录' || cleaned === '/' || cleaned === '\\') {
    navigateToFolder(null);
    return;
  }
  
  // 去掉 "此电脑/" 前缀（如果有）
  if (cleaned.startsWith('此电脑')) {
    cleaned = cleaned.replace(/^此电脑\s*[\/>\\]?\s*/, '');
  }

  if (!cleaned) {
    // 如果只有 "此电脑"，导航到根
    navigateToFolder(null);
    return;
  }

  // 按分隔符拆分路径
  const parts = cleaned.split(/\s*[\/>\\\u203a]\s*/).map(s => s.trim()).filter(Boolean);

  if (parts.length === 0) {
    showToast('无效的路径格式', 'warning');
    return;
  }

  // 从根开始逐级导航
  let currentItems = allFolders.filter(f => !f.parent_id);  // 根级别项目
  let targetFolder = null;

  for (let i = 0; i < parts.length; i++) {
    const partName = parts[i].trim();
    // 在当前级别查找匹配的文件夹
    const match = currentItems.find(item =>
      item.type === 'folder' && item.name.toLowerCase() === partName.toLowerCase()
    );
    if (match) {
      targetFolder = match;
      // 准备下一级的项目
      currentItems = allFolders.filter(f => f.parent_id === match.id);
    } else {
      showToast(`找不到文件夹: "${partName}"`, 'warning');
      return;
    }
  }

  if (targetFolder) {
    navigateToFolder(targetFolder);
  } else {
    // 如果 parts 是空的，导航到根
    navigateToFolder(null);
  }
}

// ===================================
// Textarea 自动增高函数
// ===================================
function autoResizeTextarea(textarea) {
  if (!textarea) return;
  
  // 保存当前的滚动位置
  const scrollPosition = window.scrollY;
  
  // 先重置高度以获取正确的 scrollHeight
  textarea.style.height = 'auto';
  
  // 强制浏览器重新计算样式
  const scrollHeight = textarea.scrollHeight;
  
  // 设置新的高度（最小 60px，最大 300px）
  const newHeight = Math.min(Math.max(scrollHeight, 60), 300);
  textarea.style.height = newHeight + 'px';
  
  // 恢复滚动位置
  window.scrollTo(0, scrollPosition);
}

// ===================================
// 侧边栏拖拽调整大小
// ===================================
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH_RATIO = 0.5; // 最多占视口 50%
const SIDEBAR_STORAGE_KEY = 'disk_sidebar_width';

function initSidebarResize() {
  const handle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  // 恢复上次保存的宽度
  const saved = parseInt(localStorage.getItem(SIDEBAR_STORAGE_KEY), 10);
  if (saved && saved >= SIDEBAR_MIN_WIDTH) {
    const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    sidebar.style.width = Math.min(saved, maxW) + 'px';
  }

  let startX = 0;
  let startWidth = 0;
  let rafId = null;

  function onMouseMove(e) {
    if (rafId) return; // 节流：每帧最多更新一次
    rafId = requestAnimationFrame(() => {
      const maxW = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
      const delta = e.clientX - startX;
      const newWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(startWidth + delta, maxW));
      sidebar.style.width = newWidth + 'px';
      rafId = null;
    });
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.classList.remove('sidebar-resizing');
    handle.classList.remove('resizing');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    // 保存宽度
    const currentWidth = parseInt(sidebar.style.width, 10) || sidebar.offsetWidth;
    if (currentWidth >= SIDEBAR_MIN_WIDTH) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(currentWidth));
    }
  }

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.classList.add('sidebar-resizing');
    handle.classList.add('resizing');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // 双击恢复默认宽度
  handle.addEventListener('dblclick', () => {
    sidebar.style.width = '280px';
    localStorage.setItem(SIDEBAR_STORAGE_KEY, '280');
  });
}

// ===================================
// 键盘快捷键
// ===================================
function handleKeyboardShortcuts(e) {
  // 如果焦点在输入框/文本域中，跳过大部分快捷键
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  const isInputFocused = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';
  // 检查是否有模态框打开
  const isModalOpen = document.querySelector('.modal.show') !== null;

  if (isModalOpen) return;

  switch (e.key) {
    case 'Delete':
      if (!isInputFocused && selectedItem && !isProcessingOperation) {
        e.preventDefault();
        deleteItem();
      }
      break;
    case 'F5':
      e.preventDefault();
      loadAllData();
      break;
    case 'F2':
      if (!isInputFocused && selectedItem) {
        e.preventDefault();
        editItem();
      }
      break;
    case 'Escape':
      if (!isInputFocused) {
        closeDetailsPanel();
        hideContextMenu();
        // 清空搜索
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value) {
          searchInput.value = '';
          displayCurrentFolder();
        }
      }
      break;
    case 'Backspace':
      if (!isInputFocused && currentFolder) {
        e.preventDefault();
        navigateUp();
      }
      break;
    case 'Enter':
      if (!isInputFocused && selectedItem && selectedItem.type === 'folder') {
        e.preventDefault();
        navigateToFolder(selectedItem);
      }
      break;
  }
}

// ===================================
// 列表排序
// ===================================
let sortColumn = 'name';
let sortDirection = 'asc';

async function handleSortClick(column) {
  if (sortColumn === column) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = column;
    sortDirection = 'asc';
  }
  updateSortIcons();
  // 排序变更后清除当前缓存，重新从服务端获取排序结果
  const parentKey = currentFolder ? currentFolder.id : null;
  itemCache.delete(parentKey);
  currentViewPage = 1;
  try {
    await ensureFolderLoaded(parentKey, 1);
  } catch (e) { console.error(e); }
  displayCurrentFolder();
}

function updateSortIcons() {
  document.querySelectorAll('.list-col .sort-icon').forEach(icon => {
    icon.className = 'fas fa-sort sort-icon';
  });
  const activeCol = document.querySelector(`.list-col.col-${sortColumn} .sort-icon`);
  if (activeCol) {
    activeCol.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'} sort-icon`;
  }
}

function sortItems(items) {
  const folders = items.filter(i => i.type === 'folder');
  const files = items.filter(i => i.type === 'file');
  const comparator = (a, b) => {
    let valA, valB;
    switch (sortColumn) {
      case 'name':
        valA = getDisplayName(a).toLowerCase();
        valB = getDisplayName(b).toLowerCase();
        break;
      case 'type':
        valA = a.type;
        valB = b.type;
        break;
      case 'format':
        valA = (a.format || '').toLowerCase();
        valB = (b.format || '').toLowerCase();
        break;
      case 'file_size':
        valA = parseSizeToBytes(a.file_size);
        valB = parseSizeToBytes(b.file_size);
        break;
      case 'location':
        valA = (a.location || '').toLowerCase();
        valB = (b.location || '').toLowerCase();
        break;
      case 'description':
        valA = (a.description || '').toLowerCase();
        valB = (b.description || '').toLowerCase();
        break;
      default:
        valA = getDisplayName(a).toLowerCase();
        valB = getDisplayName(b).toLowerCase();
    }
    const result = valA < valB ? -1 : valA > valB ? 1 : 0;
    return sortDirection === 'asc' ? result : -result;
  };
  folders.sort(comparator);
  files.sort(comparator);
  return [...folders, ...files];
}

// ===================================
// 文件大小格式化
// ===================================
function formatFileSize(sizeStr) {
  if (!sizeStr) return '-';
  const bytes = parseSizeToBytes(sizeStr);
  if (bytes <= 0) return escapeHtml(String(sizeStr));
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let size = bytes;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx++;
  }
  return idx > 0 ? `${size.toFixed(2)} ${units[idx]}` : `${Math.round(size)} B`;
}

function parseSizeToBytes(raw) {
  if (!raw) return 0;
  const str = String(raw).trim().toUpperCase();
  const num = parseFloat(str);
  if (!isNaN(num) && /^[\d.]+$/.test(str)) return num;
  const match = str.match(/^([\d.,]+)\s*(B|KB|MB|GB|TB|BYTES?)$/);
  if (!match) return 0;
  const val = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(val)) return 0;
  const multipliers = { B: 1, BYTE: 1, BYTES: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
  return val * (multipliers[match[2]] || 1);
}

// ===================================
// UI 锁定/解锁（防止操作冲突）
// ===================================
function lockUI() {
  isProcessingOperation = true;
  // 禁用所有操作按钮
  const buttons = document.querySelectorAll('#newFolderBtn, #newFileBtn, #localImportBtn, #deleteBtn, #importBtn, #refreshBtn');
  buttons.forEach(btn => {
    if (btn) btn.disabled = true;
  });
}

function unlockUI() {
  isProcessingOperation = false;
  // 启用所有操作按钮
  const buttons = document.querySelectorAll('#newFolderBtn, #newFileBtn, #localImportBtn, #importBtn, #refreshBtn');
  buttons.forEach(btn => {
    if (btn) btn.disabled = false;
  });
  // deleteBtn 根据是否有选中项来决定
  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) {
    deleteBtn.disabled = !selectedItem;
  }
}

// 在 allFolders 和 itemCache 中查找任意项目
function findItemByIdAnywhere(id) {
  const found = allFolders.find(i => i.id === id);
  if (found) return found;
  for (const [, entry] of itemCache) {
    const f = entry.items.find(i => i.id === id);
    if (f) return f;
  }
  return null;
}

// ===================================
// 右键菜单
// ===================================
function createContextMenu() {
  const menu = document.createElement('div');
  menu.id = 'contextMenu';
  menu.className = 'context-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);
}

function setupContextMenuHandlers() {
  // 点击其他地方关闭菜单
  document.addEventListener('click', () => {
    hideContextMenu();
  });
  
  // 阻止默认右键菜单
  document.addEventListener('contextmenu', (e) => {
    const isInFileList = e.target.closest('#fileList, #fileGrid');
    const isFileItem = e.target.closest('.file-item, .grid-item');
    const isInTreeView = e.target.closest('#folderTree');
    const isTreeItem = e.target.closest('.tree-item[data-id]');
    
    // 中间内容区的右键菜单
    if (isInFileList) {
      e.preventDefault();
      if (isFileItem) {
        // 右键点击文件/文件夹
        const itemElement = e.target.closest('.file-item, .grid-item');
        if (!itemElement) return;
        const itemId = parseInt(itemElement.dataset.id, 10);
        if (isNaN(itemId)) return;
        const item = findItemByIdAnywhere(itemId);
        showItemContextMenu(e, item, itemElement);
      } else {
        // 右键点击空白处
        showEmptyContextMenu(e);
      }
    }
    // 左侧树的右键菜单
    else if (isInTreeView && isTreeItem) {
      e.preventDefault();
      const itemElement = e.target.closest('.tree-item[data-id]');
      if (!itemElement) return;
      const itemId = parseInt(itemElement.dataset.id, 10);
      if (isNaN(itemId)) return;
      const item = findItemByIdAnywhere(itemId);
      if (item) {
        showTreeItemContextMenu(e, item);
      }
    }
  });
}

function showItemContextMenu(e, item, element) {
  if (!item || !element) return;
  contextMenuItem = item;
  
  // 先选中该项
  if (!element.classList.contains('selected')) {
    selectItem(item, element);
  }
  
  const menu = document.getElementById('contextMenu');
  menu.innerHTML = `
    <div class="context-menu-item" onclick="openModal('${item.type}', true)">
      <i class="fas fa-edit"></i> 编辑
    </div>
    <div class="context-menu-item" onclick="deleteItem()">
      <i class="fas fa-trash"></i> 删除
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" onclick="showItemProperties()">
      <i class="fas fa-info-circle"></i> 属性
    </div>
  `;
  
  showContextMenuAt(e.pageX, e.pageY);
}

function showTreeItemContextMenu(e, item) {
  contextMenuItem = item;
  selectedItem = item;
  
  const menu = document.getElementById('contextMenu');
  
  if (item.type === 'folder') {
    // 文件夹菜单
    menu.innerHTML = `
      <div class="context-menu-item" onclick="navigateToFolder(allFolders.find(i => i.id === ${item.id}))">
        <i class="fas fa-folder-open"></i> 打开
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="openModal('${item.type}', true)">
        <i class="fas fa-edit"></i> 编辑
      </div>
      <div class="context-menu-item" onclick="deleteTreeItem()">
        <i class="fas fa-trash"></i> 删除
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="showTreeItemProperties()">
        <i class="fas fa-info-circle"></i> 属性
      </div>
    `;
  } else {
    // 文件菜单
    menu.innerHTML = `
      <div class="context-menu-item" onclick="openModal('${item.type}', true)">
        <i class="fas fa-edit"></i> 编辑
      </div>
      <div class="context-menu-item" onclick="deleteTreeItem()">
        <i class="fas fa-trash"></i> 删除
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" onclick="showTreeItemProperties()">
        <i class="fas fa-info-circle"></i> 属性
      </div>
    `;
  }
  
  showContextMenuAt(e.pageX, e.pageY);
}

function showEmptyContextMenu(e) {
  const menu = document.getElementById('contextMenu');
  const toggleView = viewMode === 'list' ? 'grid' : 'list';
  const toggleIcon = viewMode === 'list' ? 'th' : 'list';
  const toggleText = viewMode === 'list' ? '网格视图' : '列表视图';
  
  menu.innerHTML = `
    <div class="context-menu-item" onclick="openModal('folder')">
      <i class="fas fa-folder-plus"></i> 新建文件夹
    </div>
    <div class="context-menu-item" onclick="openModal('file')">
      <i class="fas fa-file-plus"></i> 新建文件
    </div>
    <div class="context-menu-divider"></div>
    <div class="context-menu-item" onclick="switchView('${toggleView}')">
      <i class="fas fa-${toggleIcon}"></i> ${toggleText}
    </div>
    <div class="context-menu-item" onclick="loadAllData()">
      <i class="fas fa-sync-alt"></i> 刷新
    </div>
  `;
  
  showContextMenuAt(e.pageX, e.pageY);
}

function showContextMenuAt(x, y) {
  const menu = document.getElementById('contextMenu');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
  
  // 确保菜单不超出屏幕
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
  }
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) {
    menu.style.display = 'none';
  }
}

function showItemProperties() {
  if (contextMenuItem) {
    const el = document.querySelector(`[data-id="${contextMenuItem.id}"]`);
    selectItem(contextMenuItem, el);
  }
  hideContextMenu();
}

function showTreeItemProperties() {
  if (contextMenuItem) {
    // 显示详情面板
    selectedItem = contextMenuItem;
    showItemDetails(contextMenuItem);
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.disabled = false;
  }
  hideContextMenu();
}

async function deleteTreeItem() {
  if (!contextMenuItem || isProcessingOperation) return;
  const item = contextMenuItem;
  
  // 计算需要删除的项目数量
  const itemsToDelete = countDescendants(item);
  const hasChildren = itemsToDelete > 1;
  
  let message = `确定要删除 "${item.name}" 吗？`;
  if (hasChildren) {
    message += `\n\n警告：此操作将删除 ${itemsToDelete} 个项目（包括所有子项）！`;
  }
  if (!confirm(message)) return;
  
  hideContextMenu();
  
  // 锁定 UI
  lockUI();
  
  // 显示加载提示（对于大量项目）
  if (itemsToDelete > 50) {
    showToast(`正在删除 ${itemsToDelete} 个项目，请稍候...`, 'info');
  }
  
  try {
    const response = await fetch(`${API_ROOT}/items/${item.id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('删除请求失败');
    }
    
    const result = await response.json();
    const deletedCount = result.deleted_count || itemsToDelete;
    
    showToast(`✓ 成功删除 ${deletedCount} 个项目`, 'success');
    closeDetailsPanel();
    
    // 重新加载数据
    const loadSuccess = await loadAllData();
    if (!loadSuccess) {
      showToast('数据重新加载失败，请手动刷新页面', 'warning');
    }
  } catch (error) {
    console.error('删除失败:', error);
    showToast('删除失败：' + (error.message || '网络错误'), 'danger');
  } finally {
    // 解锁 UI
    unlockUI();
  }
}

// ===================================
// 数据加载（懒加载：只获取文件夹 + 当前文件夹子项）
// ===================================
async function loadAllData() {
  try {
    // 1. 获取所有文件夹（轻量，用于侧边栏树 / 面包屑 / 父目录选择）
    const foldersResp = await fetch(`${API_ROOT}/folders`);
    if (!foldersResp.ok) throw new Error(`Folders fetch failed: ${foldersResp.status}`);
    allFolders = await foldersResp.json();
    allItems = allFolders; // 保持向后兼容（其他функции通过 allItems 查找文件夹）

    // —— Restore folder from URL on first load ——
    if (currentFolder === null) {
      const urlParams = new URLSearchParams(window.location.search);
      const folderIdParam = urlParams.get('folder_id');
      if (folderIdParam) {
        const targetId = parseInt(folderIdParam, 10);
        const found = allFolders.find(f => f.id === targetId);
        if (found) {
          currentFolder = found;
          // Expand ancestors of the restored folder
          let temp = found;
          while (temp) {
            if (temp.parent_id) {
              expandedFolderIds.add(temp.parent_id);
              temp = allFolders.find(i => i.id === temp.parent_id) || null;
            } else {
              break;
            }
          }
        }
      }
    }

    // 2. 刷新当前文件夹的条目缓存（清除旧缓存再重新加载）
    itemCache.clear();
    const parentKey = currentFolder ? currentFolder.id : null;
    await ensureFolderLoaded(parentKey, currentViewPage);

    syncClientStateAfterDataRefresh();
    buildFolderTree();
    updateStats();
    reapplyActiveSearch();
    restoreSelectionAfterRender();
    return true;
  } catch (error) {
    console.error('加载数据失败:', error);
    showToast('加载数据失败', 'danger');
    return false;
  }
}

/**
 * 从后端获取某个父目录下的分页条目，并存入 itemCache。
 * 如果缓存已存在（且页码匹配），直接复用。
 */
async function ensureFolderLoaded(parentId, page = 1) {
  const cacheKey = parentId;
  const cached = itemCache.get(cacheKey);
  if (cached && cached.page === page) return cached; // 命中缓存

  const pidParam = parentId === null ? 'null' : parentId;
  const url = `${API_ROOT}/items?parent_id=${pidParam}&page=${page}&limit=${PAGE_LIMIT}` +
    `&sort=${sortColumn}&order=${sortDirection}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Items fetch failed: ${resp.status}`);
  const data = await resp.json();

  const entry = {
    items:       Array.isArray(data.items) ? data.items : [],
    total:       data.total       ?? 0,
    page:        data.page        ?? 1,
    total_pages: data.total_pages ?? 1,
    has_next:    data.has_next    ?? false
  };
  itemCache.set(cacheKey, entry);
  return entry;
}

/** 当前文件夹缓存的条目 */
function getCurrentCacheEntry() {
  const key = currentFolder ? currentFolder.id : null;
  return itemCache.get(key) || { items: [], total: 0, page: 1, total_pages: 1, has_next: false };
}

function syncClientStateAfterDataRefresh() {
  const idMap = new Map(allFolders.map(item => [item.id, item]));

  if (currentFolder) {
    if (idMap.has(currentFolder.id)) {
      currentFolder = idMap.get(currentFolder.id);
    } else {
      currentFolder = null;
      navigationHistory = [null];
      historyIndex = 0;
    }
  }

  if (selectedItem) {
    if (idMap.has(selectedItem.id)) {
      selectedItem = idMap.get(selectedItem.id);
    } else {
      // 可能是文件，从当前缓存查找
      const cached = getCurrentCacheEntry();
      const found = cached.items.find(i => i.id === selectedItem.id);
      if (!found) {
        selectedItem = null;
        closeDetailsPanel();
      }
    }
  }

  if (contextMenuItem && !idMap.has(contextMenuItem.id)) {
    contextMenuItem = null;
  }

  if (!Array.isArray(navigationHistory) || !navigationHistory.length) {
    navigationHistory = [currentFolder ? currentFolder.id : null];
    historyIndex = navigationHistory.length - 1;
  } else {
    navigationHistory = navigationHistory.map(id => {
      if (id === null) return null;
      return idMap.has(id) ? id : null;
    });
    if (historyIndex >= navigationHistory.length) historyIndex = navigationHistory.length - 1;
    if (historyIndex < 0) historyIndex = 0;
  }

  const historyId = navigationHistory[historyIndex];
  if (historyId === null) {
    currentFolder = null;
  } else if (idMap.has(historyId)) {
    currentFolder = idMap.get(historyId);
  } else {
    let found = false;
    for (let i = historyIndex; i >= 0; i--) {
      const id = navigationHistory[i];
      if (id === null) { historyIndex = i; currentFolder = null; found = true; break; }
      if (idMap.has(id)) { historyIndex = i; currentFolder = idMap.get(id); found = true; break; }
    }
    if (!found) { navigationHistory = [null]; historyIndex = 0; currentFolder = null; }
  }

  updateNavigationButtons();
}

// ===================================
// 左侧文件夹树构建（显示文件夹和文件）
// ===================================
// 树和面包屑拖拽接收逻辑
// ===================================
function handleTreeOrBreadcrumbDragOver(e, targetFolder) {
  if (isExternalDrag(e)) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    e.currentTarget.classList.add('drag-over');
    return;
  }
  if (draggedItem) {
    const targetId = targetFolder ? targetFolder.id : null;
    const sourceId = draggedItem.id;
    const sourceParentId = draggedItem.parent_id ?? null;
    
    // 不能拖到自己
    if (sourceId === targetId) return;
    // 不能拖到当前父目录（无意义）
    if (sourceParentId === targetId) return;
    // 不能拖到子孙目录（循环引用）
    if (targetFolder && wouldCreateCircularReference(draggedItem, targetFolder)) return;
    
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }
}

function handleTreeOrBreadcrumbDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleTreeOrBreadcrumbDrop(e, targetFolder) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  
  if (isExternalDrag(e)) {
    handleExternalDrop(e, targetFolder);
    return;
  }
  
  if (draggedItem) {
    const targetId = targetFolder ? targetFolder.id : null;
    const sourceItem = draggedItem;
    const sourceName = sourceItem ? sourceItem.name : '选中项';
    const targetName = targetFolder ? targetFolder.name : t('thisPC');
    
    if (sourceItem.id === targetId) return;
    if ((sourceItem.parent_id ?? null) === targetId) return;
    if (targetFolder && wouldCreateCircularReference(sourceItem, targetFolder)) {
      showToast(t('alertMoveCircular'), 'danger');
      return;
    }
    
    try {
      const response = await fetch(`${API_ROOT}/items/${sourceItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: targetId })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        showToast(t('alertMoveFailed', errorData.error || '服务器错误'), 'danger');
        return;
      }
      
      showToast(t('alertMoveSuccess', sourceName, targetName), 'success');
      draggedItem = null;
      loadAllData().catch(err => {
        console.error('重新加载数据失败:', err);
      });
    } catch (error) {
      console.error('移动错误:', error);
      showToast(t('alertMoveFailed', '网络错误'), 'danger');
    }
  }
}

function buildFolderTree() {
  const treeContainer = document.getElementById('folderTree');
  if (!treeContainer) return;
  treeContainer.innerHTML = '';
  
  // 建立父子关系索引，大幅提升性能 (O(N) 复杂度)
  const childrenMap = new Map();
  allFolders.forEach(folder => {
    const pid = folder.parent_id ?? null;
    if (!childrenMap.has(pid)) {
      childrenMap.set(pid, []);
    }
    childrenMap.get(pid).push(folder);
  });
  
  // 查找当前选中文件夹的所有祖先，保持其展开状态
  const activeFolderAncestors = new Set();
  let temp = currentFolder;
  while (temp) {
    if (temp.parent_id) {
      activeFolderAncestors.add(temp.parent_id);
      temp = allFolders.find(i => i.id === temp.parent_id) || null;
    } else {
      break;
    }
  }
  
  // 添加"此电脑"根节点
  const isRootExpanded = expandedFolderIds.has('root');
  const rootNode = document.createElement('div');
  rootNode.className = 'tree-item' + (!currentFolder ? ' selected' : '') + (isRootExpanded ? ' expanded' : '');
  
  const rootIcon = document.createElement('span');
  rootIcon.className = 'tree-icon';
  rootNode.appendChild(rootIcon);
  
  rootIcon.addEventListener('click', (e) => {
    e.stopPropagation();
    if (expandedFolderIds.has('root')) {
      expandedFolderIds.delete('root');
    } else {
      expandedFolderIds.add('root');
    }
    buildFolderTree();
  });
  
  const rootNameDiv = document.createElement('div');
  rootNameDiv.className = 'tree-name';
  rootNameDiv.innerHTML = `<i class="fas fa-desktop text-primary"></i><span>此电脑</span>`;
  rootNode.appendChild(rootNameDiv);
  
  rootNode.addEventListener('click', () => {
    navigateToFolder(null);
  });
  
  // 根节点接收拖拽
  rootNode.addEventListener('dragover', (e) => handleTreeOrBreadcrumbDragOver(e, null));
  rootNode.addEventListener('dragleave', handleTreeOrBreadcrumbDragLeave);
  rootNode.addEventListener('drop', (e) => handleTreeOrBreadcrumbDrop(e, null));
  
  const rootWrapper = document.createElement('div');
  rootWrapper.appendChild(rootNode);
  
  if (isRootExpanded) {
    const rootChildren = document.createElement('div');
    rootChildren.className = 'tree-children';
    rootChildren.style.display = 'block';
    
    const rootFolders = childrenMap.get(null) || [];
    rootFolders.forEach((item, index) => {
      rootChildren.appendChild(createTreeNode(item, index + 1, childrenMap, activeFolderAncestors));
    });
    
    rootWrapper.appendChild(rootChildren);
  }
  
  treeContainer.appendChild(rootWrapper);
}

function createTreeNode(item, index = null, childrenMap = new Map(), activeFolderAncestors = new Set()) {
  const isFolder = item.type === 'folder';
  const childFolders = childrenMap.get(item.id) || [];
  const hasChildren = childFolders.length > 0;
  
  const isExpanded = expandedFolderIds.has(item.id) || activeFolderAncestors.has(item.id);
  
  const itemDiv = document.createElement('div');
  itemDiv.className = 'tree-item' + (currentFolder && currentFolder.id === item.id ? ' selected' : '') + (isFolder && hasChildren && isExpanded ? ' expanded' : '');
  itemDiv.dataset.id = item.id;
  
  if (isFolder && hasChildren) {
    const icon = document.createElement('span');
    icon.className = 'tree-icon';
    itemDiv.appendChild(icon);
    
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expandedFolderIds.has(item.id)) {
        expandedFolderIds.delete(item.id);
        activeFolderAncestors.delete(item.id); // 允许用户折叠
      } else {
        expandedFolderIds.add(item.id);
      }
      buildFolderTree();
    });
  } else {
    const spacer = document.createElement('span');
    spacer.style.width = '20px';
    spacer.style.display = 'inline-block';
    itemDiv.appendChild(spacer);
  }
  
  const nameDiv = document.createElement('div');
  nameDiv.className = 'tree-name';
  const iconClass = getItemIcon(item);
  const iconColor = getIconColor(item);
  const label = item.type === 'file' ? getDisplayName(item) : item.name;
  const numberPrefix = index !== null ? `<span class="item-number">#${index}</span>` : '';
  nameDiv.innerHTML = `${numberPrefix}<i class="${iconClass} ${iconColor}"></i><span>${escapeHtml(label)}</span>`;
  itemDiv.appendChild(nameDiv);
  
  itemDiv.addEventListener('click', () => {
    if (isFolder) {
      navigateToFolder(item);
    } else {
      const parent = item.parent_id ? allFolders.find(i => i.id === item.parent_id) : null;
      navigateToFolder(parent);
      setTimeout(() => {
        const fileElement = document.querySelector(`[data-id="${item.id}"]`);
        if (fileElement) {
          selectItem(item, fileElement);
          fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  });
  
  // 树节点支持拖拽
  itemDiv.draggable = true;
  itemDiv.addEventListener('dragstart', (e) => handleDragStart(e, item));
  itemDiv.addEventListener('dragover', (e) => handleTreeOrBreadcrumbDragOver(e, item));
  itemDiv.addEventListener('dragleave', handleTreeOrBreadcrumbDragLeave);
  itemDiv.addEventListener('drop', (e) => handleTreeOrBreadcrumbDrop(e, item));
  itemDiv.addEventListener('dragend', (e) => handleDragEnd(e));
  
  const wrapper = document.createElement('div');
  wrapper.appendChild(itemDiv);
  
  // 仅在父节点展开时，才渲染其子节点 DOM (懒加载 / 性能关键优化)
  if (isFolder && hasChildren && isExpanded) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-children';
    childrenDiv.style.display = 'block';
    
    childFolders.forEach((child, idx) => {
      childrenDiv.appendChild(createTreeNode(child, idx + 1, childrenMap, activeFolderAncestors));
    });
    
    wrapper.appendChild(childrenDiv);
  }
  
  return wrapper;
}

function toggleTreeNode(itemDiv) {
  itemDiv.classList.toggle('expanded');
}

// ===================================
// 导航功能
// ===================================
async function navigateToFolder(folder) {
  if (historyIndex < navigationHistory.length - 1) {
    navigationHistory = navigationHistory.slice(0, historyIndex + 1);
  }
  navigationHistory.push(folder ? folder.id : null);
  historyIndex++;
  currentFolder = folder;
  currentViewPage = 1; // 进入新文件夹时重置页码

  if (folder) {
    selectedItem = folder;
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) deleteBtn.disabled = false;
  } else {
    closeDetailsPanel();
  }

  // 开始过渡
  const contentContainers = ['fileList', 'fileGrid'];
  contentContainers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('content-transitioning');
  });

  try {
    await ensureFolderLoaded(folder ? folder.id : null, 1);
  } catch (err) {
    console.error('加载文件夹内容失败:', err);
    showToast('加载内容失败，请重试', 'danger');
  }

  if (folder) showItemDetails(folder); // 在加载完后更新详情（包含子项计数）

  displayCurrentFolder();
  updateNavigationButtons();
  buildFolderTree();

  requestAnimationFrame(() => {
    contentContainers.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('content-transitioning');
    });
  });
}

async function navigateBack() {
  if (historyIndex > 0) {
    historyIndex--;
    const folderId = navigationHistory[historyIndex];
    currentFolder = folderId ? (allFolders.find(i => i.id === folderId) || null) : null;
    currentViewPage = 1;

    if (currentFolder) {
      selectedItem = currentFolder;
      const deleteBtn = document.getElementById('deleteBtn');
      if (deleteBtn) deleteBtn.disabled = false;
    } else {
      closeDetailsPanel();
    }

    try { await ensureFolderLoaded(currentFolder ? currentFolder.id : null, 1); } catch (e) {}
    if (currentFolder) showItemDetails(currentFolder);
    displayCurrentFolder();
    updateNavigationButtons();
    buildFolderTree();
  }
}

async function navigateForward() {
  if (historyIndex < navigationHistory.length - 1) {
    historyIndex++;
    const folderId = navigationHistory[historyIndex];
    currentFolder = folderId ? (allFolders.find(i => i.id === folderId) || null) : null;
    currentViewPage = 1;

    if (currentFolder) {
      selectedItem = currentFolder;
      const delBtn = document.getElementById('deleteBtn');
      if (delBtn) delBtn.disabled = false;
    } else {
      closeDetailsPanel();
    }

    try { await ensureFolderLoaded(currentFolder ? currentFolder.id : null, 1); } catch (e) {}
    if (currentFolder) showItemDetails(currentFolder);
    displayCurrentFolder();
    updateNavigationButtons();
    buildFolderTree();
  }
}

function navigateUp() {
  if (currentFolder) {
    const parentFolder = currentFolder.parent_id
      ? (allFolders.find(i => i.id === currentFolder.parent_id) || null)
      : null;
    navigateToFolder(parentFolder);
  }
}

function updateNavigationButtons() {
  document.getElementById('backBtn').disabled = historyIndex <= 0;
  document.getElementById('forwardBtn').disabled = historyIndex >= navigationHistory.length - 1;
  document.getElementById('upBtn').disabled = !currentFolder;
}

// ===================================
// 显示当前文件夹内容（使用 itemCache）
// ===================================
function displayCurrentFolder() {
  updateBreadcrumb();
  
  // 刷新 URL 参数
  const url = new URL(window.location.href);
  if (currentFolder) {
    url.searchParams.set('folder_id', currentFolder.id);
  } else {
    url.searchParams.delete('folder_id');
  }
  window.history.replaceState(null, '', url.toString());

  const entry = getCurrentCacheEntry();
  const items = entry.items || [];

  currentViewTotal      = entry.total       || 0;
  currentViewTotalPages = entry.total_pages || 1;

  if (viewMode === 'list') {
    displayListView(items);
  } else {
    displayGridView(items);
  }

  const isEmpty = items.length === 0;
  const emptyState = document.getElementById('emptyState');
  const listHeader = document.getElementById('listHeader');
  if (emptyState) emptyState.style.display = isEmpty ? 'flex' : 'none';
  if (listHeader) listHeader.style.display = isEmpty || viewMode === 'grid' ? 'none' : 'flex';

  renderPaginationBar(currentViewPage, currentViewTotalPages, currentViewTotal);
}

// ===================================
// 分页条渲染
// ===================================
function renderPaginationBar(page, totalPages, total, gotoFn = 'gotoViewPage') {
  let bar = document.getElementById('paginationBar');
  if (!bar) {
    // 嵌入到 content-area
    bar = document.createElement('div');
    bar.id = 'paginationBar';
    bar.className = 'pagination-bar';
    const contentArea = document.querySelector('.content-area');
    if (contentArea) contentArea.appendChild(bar);
  }

  if (totalPages <= 1) {
    bar.innerHTML = total > 0
      ? `<span class="pg-info">${t('totalItems', total)}</span>`
      : '';
    return;
  }

  let html = `<span class="pg-info">${t('paginationInfo', total, page, totalPages)}</span>
    <div class="pg-controls">`;

  html += `<button class="pg-btn" ${page <= 1 ? 'disabled' : ''} onclick="${gotoFn}(1)">
    <i class="fas fa-angle-double-left"></i></button>`;
  html += `<button class="pg-btn" ${page <= 1 ? 'disabled' : ''} onclick="${gotoFn}(${page - 1})">
    <i class="fas fa-angle-left"></i></button>`;

  // 页码按钮（当前页前后各 2 页）
  const start = Math.max(1, page - 2);
  const end   = Math.min(totalPages, page + 2);
  if (start > 1) html += `<span class="pg-ellipsis">…</span>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="pg-btn ${i === page ? 'active' : ''}" onclick="${gotoFn}(${i})">${i}</button>`;
  }
  if (end < totalPages) html += `<span class="pg-ellipsis">…</span>`;

  html += `<button class="pg-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${gotoFn}(${page + 1})">
    <i class="fas fa-angle-right"></i></button>`;
  html += `<button class="pg-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${gotoFn}(${totalPages})">
    <i class="fas fa-angle-double-right"></i></button>`;

  html += `</div>`;
  bar.innerHTML = html;
}

async function gotoViewPage(page) {
  if (page < 1 || page > currentViewTotalPages || page === currentViewPage) return;
  currentViewPage = page;
  const parentKey = currentFolder ? currentFolder.id : null;
  itemCache.delete(parentKey); // 清除当前缓存以换页
  try {
    await ensureFolderLoaded(parentKey, page);
  } catch (err) {
    showToast('加载失败，请重试', 'danger');
    return;
  }
  displayCurrentFolder();
}

async function gotoSearchPage(page) {
  if (page < 1 || page > currentSearchTotalPages || page === currentSearchPage) return;
  currentSearchPage = page;
  try {
    const fields = getSelectedSearchFields();
    const resp = await fetch(`${API_ROOT}/search?q=${encodeURIComponent(currentSearchQuery)}&fields=${fields.join(',')}&page=${page}&limit=200`);
    const data = await resp.json();
    const results = Array.isArray(data) ? data : (data.items || []);
    const total = data.total ?? results.length;
    const totalPages = data.total_pages ?? 1;
    currentSearchTotalPages = totalPages;

    if (viewMode === 'list') {
      displayListView(results, true);
      const listHeader = document.getElementById('listHeader');
      if (listHeader) listHeader.style.display = results.length === 0 ? 'none' : 'flex';
    } else {
      displayGridView(results, true);
      const listHeader = document.getElementById('listHeader');
      if (listHeader) listHeader.style.display = 'none';
    }

    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = results.length === 0 ? 'flex' : 'none';

    renderPaginationBar(page, totalPages, total, 'gotoSearchPage');
  } catch (err) {
    console.error('搜索翻页失败:', err);
    showToast('搜索翻页失败', 'danger');
  }
}

function updateBreadcrumb() {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!breadcrumb) return;
  breadcrumb.innerHTML = '';
  const path = [];
  let current = currentFolder;
  while (current) {
    path.unshift(current);
    current = current.parent_id ? allFolders.find(i => i.id === current.parent_id) : null;
  }

  const rootSpan = document.createElement('span');
  rootSpan.className = 'breadcrumb-item' + (!currentFolder ? ' active' : '');
  rootSpan.textContent = '此电脑';
  rootSpan.addEventListener('click', () => navigateToFolder(null));
  
  // 根级别面包屑接收拖拽
  rootSpan.addEventListener('dragover', (e) => handleTreeOrBreadcrumbDragOver(e, null));
  rootSpan.addEventListener('dragleave', handleTreeOrBreadcrumbDragLeave);
  rootSpan.addEventListener('drop', (e) => handleTreeOrBreadcrumbDrop(e, null));
  
  breadcrumb.appendChild(rootSpan);

  path.forEach((folder, index) => {
    const span = document.createElement('span');
    span.className = 'breadcrumb-item' + (index === path.length - 1 ? ' active' : '');
    span.textContent = folder.name;
    span.addEventListener('click', () => navigateToFolder(folder));
    
    // 面包屑节点接收拖拽
    span.addEventListener('dragover', (e) => handleTreeOrBreadcrumbDragOver(e, folder));
    span.addEventListener('dragleave', handleTreeOrBreadcrumbDragLeave);
    span.addEventListener('drop', (e) => handleTreeOrBreadcrumbDrop(e, folder));
    
    breadcrumb.appendChild(span);
  });
}

function restoreSelectionAfterRender() {
  if (!selectedItem) {
    return;
  }

  let element = document.querySelector(`.file-item[data-id="${selectedItem.id}"]`);
  if (!element) {
    element = document.querySelector(`.grid-item[data-id="${selectedItem.id}"]`);
  }
  if (element) {
    element.classList.add('selected');
  }
  showItemDetails(selectedItem);
  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) deleteBtn.disabled = false;
}

function displayListView(items, presorted = false) {
  const container = document.getElementById('fileList');
  const gridContainer = document.getElementById('fileGrid');
  container.style.display = 'block';
  gridContainer.style.display = 'none';
  
  const fragment = document.createDocumentFragment();
  const allSortedItems = presorted ? items : sortItems(items);
  
  allSortedItems.forEach((item, index) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'file-item fade-in-item';
    itemDiv.dataset.id = item.id;
    itemDiv.style.animationDelay = `${Math.min(index * 15, 300)}ms`;
    const icon = getItemIcon(item);
    const iconColor = getIconColor(item);
    const displayName = escapeHtml(getDisplayName(item));
    const locationTitle = escapeHtml(item.location || '未设置');
    const locationHtml = item.location ? formatLocationHtml(item.location) : '未设置';
    const sizeDisplay = item.type === 'file' ? formatFileSize(item.file_size) : '-';
    const itemNumber = index + 1;
    itemDiv.innerHTML = `
      <div class="file-number">#${itemNumber}</div>
      <div class="file-icon ${iconColor}"><i class="${icon}"></i></div>
      <div class="file-name">${displayName}</div>
      <div class="file-type">${item.type === 'folder' ? '文件夹' : '文件'}</div>
      <div class="file-format">${item.format ? `<span class="badge">${escapeHtml(item.format)}</span>` : '-'}</div>
      <div class="file-size" title="${escapeHtml(item.file_size || '')}">${sizeDisplay}</div>
      <div class="file-location" title="${locationTitle}">${locationHtml}</div>
      <div class="file-description" title="${escapeHtml(item.description || '')}">${escapeHtml(item.description || '-')}</div>
    `;
    itemDiv.addEventListener('click', () => selectItem(item, itemDiv));
    itemDiv.addEventListener('dblclick', () => {
      if (item.type === 'folder') {
        navigateToFolder(item);
      } else if (item.location && isHttpUrl(item.location)) {
        window.open(item.location, '_blank', 'noopener,noreferrer');
      }
    });
    itemDiv.draggable = true;
    itemDiv.addEventListener('dragstart', (e) => handleDragStart(e, item));
    itemDiv.addEventListener('dragover', (e) => handleDragOver(e, item));
    itemDiv.addEventListener('dragleave', (e) => handleDragLeave(e));
    itemDiv.addEventListener('drop', (e) => handleDrop(e, item));
    itemDiv.addEventListener('dragend', (e) => handleDragEnd(e));
    fragment.appendChild(itemDiv);
  });
  
  container.innerHTML = '';
  container.appendChild(fragment);
}

function displayGridView(items, presorted = false) {
  const container = document.getElementById('fileGrid');
  const listContainer = document.getElementById('fileList');
  container.style.display = 'grid';
  listContainer.style.display = 'none';
  
  const fragment = document.createDocumentFragment();
  const allSortedItems = presorted ? items : sortItems(items);
  
  allSortedItems.forEach((item, index) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'grid-item fade-in-item';
    itemDiv.dataset.id = item.id;
    itemDiv.style.animationDelay = `${Math.min(index * 20, 400)}ms`;
    const icon = getItemIcon(item);
    const iconColor = getIconColor(item);
    const displayName = escapeHtml(getDisplayName(item));
    const sizeDisplay = item.type === 'file' && item.file_size ? formatFileSize(item.file_size) : '';
    const itemNumber = index + 1;
    itemDiv.innerHTML = `
      <div class="grid-number">#${itemNumber}</div>
      <div class="grid-icon ${iconColor}"><i class="${icon}"></i></div>
      <div class="grid-name">${displayName}</div>
      ${item.format ? `<div class="grid-format">${escapeHtml(item.format)}</div>` : ''}
      ${sizeDisplay ? `<div class="grid-size">${sizeDisplay}</div>` : ''}
    `;
    itemDiv.addEventListener('click', () => selectItem(item, itemDiv));
    itemDiv.addEventListener('dblclick', () => {
      if (item.type === 'folder') {
        navigateToFolder(item);
      } else if (item.location && isHttpUrl(item.location)) {
        window.open(item.location, '_blank', 'noopener,noreferrer');
      }
    });
    itemDiv.draggable = true;
    itemDiv.addEventListener('dragstart', (e) => handleDragStart(e, item));
    itemDiv.addEventListener('dragover', (e) => handleDragOver(e, item));
    itemDiv.addEventListener('dragleave', (e) => handleDragLeave(e));
    itemDiv.addEventListener('drop', (e) => handleDrop(e, item));
    itemDiv.addEventListener('dragend', (e) => handleDragEnd(e));
    fragment.appendChild(itemDiv);
  });
  
  container.innerHTML = '';
  container.appendChild(fragment);
}

// ===================================
// 改进的拖拽功能
// ===================================
let draggedItem = null;

function handleDragStart(e, item) {
  draggedItem = item;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
  
  // 创建拖拽预览
  const dragImage = e.currentTarget.cloneNode(true);
  dragImage.style.opacity = '0.7';
  dragImage.style.position = 'absolute';
  dragImage.style.top = '-1000px';
  document.body.appendChild(dragImage);
  e.dataTransfer.setDragImage(dragImage, 20, 20);
  setTimeout(() => dragImage.remove(), 0);
}

function handleDragOver(e, item) {
  if (isExternalDrag(e)) {
    if (item.type === 'folder') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      e.currentTarget.classList.add('drag-over');
    }
    return;
  }
  if (draggedItem && item.type === 'folder' && draggedItem.id !== item.id) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, targetItem) {
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('drag-over');
  
  if (isExternalDrag(e)) {
    const targetFolder = targetItem.type === 'folder' ? targetItem : currentFolder;
    handleExternalDrop(e, targetFolder);
    return;
  }
  
  if (draggedItem && targetItem.type === 'folder' && draggedItem.id !== targetItem.id) {
    // 在异步操作前保留引用，避免 dragend 事件提前清空状态
    const sourceItem = draggedItem;
    const sourceName = sourceItem ? sourceItem.name : '选中项';
    const targetName = targetItem.name;
    if (wouldCreateCircularReference(sourceItem, targetItem)) {
      showToast('无法移动：会造成循环引用', 'danger');
      return;
    }
    
    try {
      const response = await fetch(`${API_ROOT}/items/${sourceItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: targetItem.id })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        showToast(`移动失败：${errorData.error || '服务器错误'}`, 'danger');
        return;
      }
      
      // 响应成功，先显示成功消息
      showToast(`✓ 已将 "${sourceName}" 移动到 "${targetName}"`, 'success');
      
      // 重新加载数据（不阻塞，即使失败也不影响成功提示）
      loadAllData().catch(err => {
        console.error('重新加载数据失败:', err);
        // 数据已经在服务器端更新，刷新失败不影响操作结果
      });
      draggedItem = null;
      
    } catch (error) {
      console.error('移动错误:', error);
      showToast('移动失败：网络错误', 'danger');
    }
  }
}

function handleDragEnd(e) {
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedItem = null;
}

function wouldCreateCircularReference(item, newParent) {
  let current = newParent;
  while (current) {
    if (current.id === item.id) return true;
    current = current.parent_id ? allFolders.find(i => i.id === current.parent_id) : null;
  }
  return false;
}

// ===================================
// 项目选择
// ===================================
function selectItem(item, element) {
  if (!item) return;
  document.querySelectorAll('.file-item.selected, .grid-item.selected').forEach(el => {
    el.classList.remove('selected');
  });
  if (element) element.classList.add('selected');
  selectedItem = item;
  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) deleteBtn.disabled = false;
  showItemDetails(item);
}

function showItemDetails(item) {
  const detailsContent = document.getElementById('detailsContent');
  if (!detailsContent || !item) return;
  const icon = getItemIcon(item);
  const iconColor = getIconColor(item);
  const managementPath = getManagementPath(item);
  const displayName = getDisplayName(item);
  const typeLabel = item.type === 'folder' ? '文件夹' : '文件';
  const descriptionHtml = item.description ? escapeHtml(item.description).replace(/\n/g, '<br>') : '无描述';
  const locationHtml = formatLocationHtml(item.location);

  let html = `<div class="detail-preview"><div class="${iconColor}"><i class="${icon}"></i></div><div class="item-name">${escapeHtml(displayName)}</div><div class="item-type">${typeLabel}</div></div>`;
  html += `<div class="detail-field"><label>名称</label><div class="value">${escapeHtml(displayName)}</div></div>`;
  html += `<div class="detail-field"><label>类型</label><div class="value">${typeLabel}</div></div>`;
  if (item.type === 'file' && item.format) {
    html += `<div class="detail-field"><label>格式</label><div class="value">${escapeHtml(item.format)}</div></div>`;
  }
  if (item.type === 'file' && item.file_size) {
    html += `<div class="detail-field"><label>文件大小</label><div class="value">${formatFileSize(item.file_size)}</div></div>`;
  }
  
  // 增加"总大小"字段用于文件夹递归计算
  if (item.type === 'folder') {
    html += `<div class="detail-field" id="detailTotalSizeField"><label>总大小</label><div class="value" id="detailTotalSizeValue"><i class="fas fa-spinner fa-spin me-1"></i>计算中...</div></div>`;
  }
  
  html += `<div class="detail-field"><label>硬盘管理路径</label><div class="value">${escapeHtml(managementPath)}</div></div>`;
  html += `<div class="detail-field"><label>位置</label><div class="value ${item.location ? '' : 'empty'}">${locationHtml}</div></div>`;
  html += `<div class="detail-field"><label>描述</label><div class="value ${item.description ? '' : 'empty'}">${descriptionHtml}</div></div>`;
  
  if (item.updated_at) {
    html += `<div class="detail-field"><label>修改日期</label><div class="value">${escapeHtml(item.updated_at)}</div></div>`;
  }

  if (item.type === 'folder') {
    // 使用已缓存的子项（如果该文件夹已加载过）
    const cachedEntry = itemCache.get(item.id);
    const children = cachedEntry ? cachedEntry.items : [];
    const childFolders = children.filter(i => i.type === 'folder').length;
    const childFiles = children.filter(i => i.type === 'file').length;
    const unknownSuffix = cachedEntry && cachedEntry.total > children.length ? '+' : '';
    html += `<div class="detail-field"><label>包含</label><div class="value">${childFolders}⁠ 个文件夹, ${childFiles}${unknownSuffix} 个文件</div></div>`;
    const formats = {};
    children.filter(i => i.type === 'file' && i.format).forEach(i => {
      formats[i.format] = (formats[i.format] || 0) + 1;
    });
    if (Object.keys(formats).length > 0) {
      html += `<div class="detail-field"><label>文件格式</label><div class="value">${Object.entries(formats).map(([fmt, count]) => `<span class="format-tag">${escapeHtml(fmt)} (${count})</span>`).join(' ')}</div></div>`;
    }
  }
  html += `<div class="detail-actions"><button class="btn btn-sm btn-primary" onclick="editItem()"><i class="fas fa-edit"></i> 编辑</button><button class="btn btn-sm btn-danger" onclick="deleteItem()"><i class="fas fa-trash"></i> 删除</button></div>`;
  detailsContent.innerHTML = html;

  // 异步加载最新属性
  fetch(`${API_ROOT}/items/${item.id}`)
    .then(res => {
      if (res.ok) return res.json();
      throw new Error('Details fetch failed');
    })
    .then(data => {
      if (selectedItem && selectedItem.id === item.id) {
        selectedItem.updated_at = data.updated_at;
        
        // 更新总大小
        const sizeVal = document.getElementById('detailTotalSizeValue');
        if (sizeVal) {
          sizeVal.textContent = data.total_size_display || '0 B';
        }
        
        // 更新修改日期
        if (data.updated_at) {
          let hasDateField = false;
          const fields = detailsContent.querySelectorAll('.detail-field');
          fields.forEach(f => {
            const label = f.querySelector('label');
            if (label && label.textContent === '修改日期') {
              hasDateField = true;
              f.querySelector('.value').textContent = data.updated_at;
            }
          });
          
          if (!hasDateField) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'detail-field';
            dateDiv.innerHTML = `<label>修改日期</label><div class="value">${escapeHtml(data.updated_at)}</div>`;
            const actionsDiv = detailsContent.querySelector('.detail-actions');
            if (actionsDiv) {
              detailsContent.insertBefore(dateDiv, actionsDiv);
            } else {
              detailsContent.appendChild(dateDiv);
            }
          }
        }
      }
    })
    .catch(err => {
      console.warn('获取详情失败:', err);
      const sizeVal = document.getElementById('detailTotalSizeValue');
      if (sizeVal) {
        sizeVal.textContent = '计算失败';
      }
    });
}

function closeDetailsPanel() {
  selectedItem = null;
  document.querySelectorAll('.file-item.selected, .grid-item.selected').forEach(el => {
    el.classList.remove('selected');
  });
  const deleteBtn = document.getElementById('deleteBtn');
  if (deleteBtn) deleteBtn.disabled = true;
  const detailsContent = document.getElementById('detailsContent');
  if (detailsContent) detailsContent.innerHTML = `<div class="no-selection"><i class="fas fa-mouse-pointer"></i><p>选择一个项目以查看详情</p></div>`;
}

// ===================================
// 视图切换
// ===================================
function switchView(mode) {
  viewMode = mode;
  const gridBtn = document.getElementById('viewGridBtn');
  const listBtn = document.getElementById('viewListBtn');
  const listHeader = document.getElementById('listHeader');
  if (gridBtn) gridBtn.classList.toggle('active', mode === 'grid');
  if (listBtn) listBtn.classList.toggle('active', mode === 'list');
  if (listHeader) listHeader.style.display = mode === 'list' ? 'flex' : 'none';
  displayCurrentFolder();
  hideContextMenu();
}

// ===================================
// 搜索功能
// ===================================
let searchTimeout;
function handleSearch(e) {
  triggerSearch(e.target.value);
}

function triggerSearch(rawValue, immediate = false) {
  clearTimeout(searchTimeout);
  const trimmed = (rawValue || '').trim();

  const executeSearch = async () => {
    if (!trimmed) {
      isSearchActive = false;
      renderPaginationBar(currentViewPage, currentViewTotalPages, currentViewTotal);
      displayCurrentFolder();
      return false;
    }

    try {
      const fields = getSelectedSearchFields();
      const resp = await fetch(`${API_ROOT}/search?q=${encodeURIComponent(trimmed)}&fields=${fields.join(',')}&page=1&limit=200`);
      const data = await resp.json();
      const results = Array.isArray(data) ? data : (data.items || []);
      const total = data.total ?? results.length;
      const totalPages = data.total_pages ?? 1;

      isSearchActive = true;
      currentSearchQuery = trimmed;
      currentSearchPage = 1;
      currentSearchTotalPages = totalPages;

      if (viewMode === 'list') {
        displayListView(results, true);
        const listHeader = document.getElementById('listHeader');
        if (listHeader) listHeader.style.display = results.length === 0 ? 'none' : 'flex';
      } else {
        displayGridView(results, true);
        const listHeader = document.getElementById('listHeader');
        if (listHeader) listHeader.style.display = 'none';
      }

      const emptyState = document.getElementById('emptyState');
      if (emptyState) emptyState.style.display = results.length === 0 ? 'flex' : 'none';

      renderPaginationBar(1, totalPages, total, 'gotoSearchPage');
    } catch (err) {
      console.error('搜索失败:', err);
      showToast('搜索失败', 'danger');
    }
    return true;
  };

  if (immediate) {
    return executeSearch();
  }

  if (!trimmed) {
    displayCurrentFolder();
    return false;
  }

  searchTimeout = setTimeout(executeSearch, 300);
  return undefined;
}

function getSelectedSearchFields() {
  const fields = [];
  if (document.getElementById('searchName')?.checked) fields.push('name');
  if (document.getElementById('searchDate')?.checked) fields.push('date');
  if (document.getElementById('searchPath')?.checked) fields.push('path');
  if (document.getElementById('searchDesc')?.checked) fields.push('desc');
  if (document.getElementById('searchFormat')?.checked) fields.push('format');
  return fields;
}

function reapplyActiveSearch() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) {
    displayCurrentFolder();
    return false;
  }
  const val = searchInput.value;
  if (!val || !val.trim()) {
    displayCurrentFolder();
    return false;
  }
  triggerSearch(val, true);
  return true;
}

// ===================================
// 模态框操作
// ===================================
function openModal(type, editMode = false) {
  hideContextMenu();
  const modal = new bootstrap.Modal(document.getElementById('itemModal'));
  const form = document.getElementById('itemForm');
  form.reset();
  document.getElementById('itemType').value = type;
  document.getElementById('formatGroup').style.display = type === 'file' ? 'block' : 'none';
  document.getElementById('sizeGroup').style.display = type === 'file' ? 'block' : 'none';
  let defaultParentId = currentFolder ? currentFolder.id : null;
  if (editMode && selectedItem) {
    document.getElementById('itemId').value = selectedItem.id;
    document.getElementById('itemName').value = selectedItem.name;
    document.getElementById('itemDesc').value = selectedItem.description || '';
    document.getElementById('itemLocation').value = selectedItem.location || '';
    document.getElementById('itemFormat').value = selectedItem.format || '';
    document.getElementById('itemFileSize').value = selectedItem.file_size || '';
    defaultParentId = selectedItem.parent_id ?? null;
    document.getElementById('modalTitleText').textContent = type === 'folder' ? t('modalTitleEditFolder') : t('modalTitleEditFile');
  } else {
    document.getElementById('itemId').value = '';
    document.getElementById('itemFileSize').value = '';
    document.getElementById('modalTitleText').textContent = type === 'folder' ? t('modalTitleNewFolder') : t('modalTitleNewFile');
    
    // 设置默认描述
    if (type === 'file') {
      document.getElementById('itemDesc').value = '视频分辨率：\n文件大小：\n时长：\n生肉：\n音频：\n水印：\n声音质量：';
    } else {
      document.getElementById('itemDesc').value = '';
    }
  }
  populateParentSelect(defaultParentId);
  modal.show();
  
  // 模态框显示后调用自动增高函数
  // 使用 requestAnimationFrame 确保 DOM 已完全渲染
  requestAnimationFrame(() => {
    autoResizeTextarea(document.getElementById('itemDesc'));
  });
}

function populateParentSelect(defaultParentId = null) {
  const select = document.getElementById('parentSelect');
  const currentId = document.getElementById('itemId').value;
  select.innerHTML = `<option value="">${t('formParentRoot')}</option>`;
  const folders = allFolders.filter(item => item.id != currentId);
  folders.forEach(folder => {
    const option = document.createElement('option');
    option.value = folder.id;
    option.textContent = getFolderPath(folder);
    select.appendChild(option);
  });
  if (defaultParentId !== null && defaultParentId !== undefined) {
    select.value = String(defaultParentId);
    if (select.value !== String(defaultParentId)) {
      select.value = '';
    }
  } else {
    select.value = '';
  }
}

function getFolderPath(folder) {
  const path = [folder.name];
  let current = folder;
  while (current && current.parent_id) {
    current = allFolders.find(i => i.id === current.parent_id) || null;
    if (current) path.unshift(current.name);
  }
  return path.join(' > ');
}

function getManagementPath(item) {
  if (!item) return '此电脑';
  const segments = [];
  const seen = new Set();
  let current = item;
  while (current && (!current.id || !seen.has(current.id))) {
    if (current.id) {
      seen.add(current.id);
    }
    segments.unshift(current.name);
    if (!current.parent_id) {
      break;
    }
    current = allFolders.find(entry => entry.id === current.parent_id) || null;
  }
  return segments.length ? `此电脑 > ${segments.join(' > ')}` : '此电脑';
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const idEl = document.getElementById('itemId');
  const typeEl = document.getElementById('itemType');
  const nameEl = document.getElementById('itemName');
  const descEl = document.getElementById('itemDesc');
  const locEl = document.getElementById('itemLocation');
  const fmtEl = document.getElementById('itemFormat');
  const sizeEl = document.getElementById('itemFileSize');
  const parentEl = document.getElementById('parentSelect');
  if (!idEl || !typeEl || !nameEl || !descEl || !locEl || !fmtEl || !sizeEl || !parentEl) {
    showToast('表单元素缺失，请刷新页面', 'danger');
    return;
  }
  const id = idEl.value;
  const type = typeEl.value;
  const name = nameEl.value.trim();
  const description = descEl.value.trim();
  const location = locEl.value.trim();
  const format = fmtEl.value.trim();
  const fileSize = sizeEl.value.trim();
  const parent_id = parentEl.value;
  if (!name) {
    showToast('名称不能为空', 'warning');
    nameEl.focus();
    return;
  }
  if (name.includes('/')) {
    showToast('名称中不能包含斜杠字符 "/"', 'warning');
    nameEl.focus();
    return;
  }
  if (type !== 'file' && type !== 'folder') {
    showToast('类型无效', 'danger');
    return;
  }
  const data = {
    name,
    type,
    description: description || null,
    location: location || null,
    format: type === 'file' ? (format || null) : null,
    file_size: type === 'file' ? (fileSize || null) : null,
    parent_id: parent_id ? parseInt(parent_id) : null
  };

  // 编辑模式下检查循环引用（不能把文件夹移到自己的子文件夹下）
  if (id && data.parent_id) {
    const editingItem = findItemByIdAnywhere(parseInt(id));
    const newParent = allFolders.find(i => i.id === data.parent_id);
    if (editingItem && newParent && wouldCreateCircularReference(editingItem, newParent)) {
      showToast('无法保存：不能将文件夹移到自己的子文件夹下', 'danger');
      return;
    }
  }

  try {
    if (id) {
      const response = await fetch(`${API_ROOT}/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '服务器错误');
      }
      showToast('✓ 编辑成功', 'success');
    } else {
      const response = await fetch(`${API_ROOT}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '服务器错误');
      }
      showToast('✓ 创建成功', 'success');
    }
    const modalEl = document.getElementById('itemModal');
    const modalInst = modalEl && bootstrap.Modal.getInstance(modalEl);
    if (modalInst) modalInst.hide();
    loadAllData().catch(err => {
      console.error('重新加载数据失败:', err);
    });
  } catch (error) {
    showToast('操作失败：' + (error.message || '未知错误'), 'danger');
  }
}

function editItem() {
  if (!selectedItem) return;
  openModal(selectedItem.type, true);
}

async function deleteItem() {
  if (!selectedItem || isProcessingOperation) return;
  
  // 计算需要删除的项目数量
  const itemsToDelete = countDescendants(selectedItem);
  const hasChildren = itemsToDelete > 1;
  
  let message = `确定要删除 "${selectedItem.name}" 吗？`;
  if (hasChildren) {
    message += `\n\n警告：此操作将删除 ${itemsToDelete} 个项目（包括所有子项）！`;
  }
  if (!confirm(message)) return;
  
  // 锁定 UI
  lockUI();
  
  // 显示加载提示（对于大量项目）
  if (itemsToDelete > 50) {
    showToast(`正在删除 ${itemsToDelete} 个项目，请稍候...`, 'info');
  }
  
  try {
    const response = await fetch(`${API_ROOT}/items/${selectedItem.id}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('删除请求失败');
    }
    
    const result = await response.json();
    const deletedCount = result.deleted_count || itemsToDelete;
    
    showToast(`✓ 成功删除 ${deletedCount} 个项目`, 'success');
    closeDetailsPanel();
    
    // 重新加载数据
    const loadSuccess = await loadAllData();
    if (!loadSuccess) {
      showToast('数据重新加载失败，请手动刷新页面', 'warning');
    }
  } catch (error) {
    console.error('删除失败:', error);
    showToast('删除失败：' + (error.message || '未知错误'), 'danger');
  } finally {
    // 解锁 UI
    unlockUI();
  }
}

// 计算项目及其所有后代的数量
function countDescendants(item) {
  if (!item) return 0;
  let count = 1;
  // 使用 allFolders + itemCache 估算后代数量
  const knownChildren = (() => {
    const seen = new Set();
    const result = [];
    const fromFolders = allFolders.filter(i => i.parent_id === item.id);
    const fromCache = (itemCache.get(item.id) || { items: [] }).items;
    for (const c of [...fromFolders, ...fromCache]) {
      if (!seen.has(c.id)) { seen.add(c.id); result.push(c); }
    }
    return result;
  })();
  for (const child of knownChildren) {
    count += countDescendants(child);
  }
  return count;
}

// ===================================
// 导出/导入
// ===================================
function handleExportClick(e) {
  e.preventDefault();
  const el = e.currentTarget;
  const format = el.dataset.format || 'json';
  const scope = el.dataset.scope || 'all';

  if (scope === 'folder') {
    if (currentFolder) {
      window.location.href = `${API_ROOT}/export?format=${format}&scope=folder&item_id=${currentFolder.id}&lang=${activeLang}`;
    } else {
      window.location.href = `${API_ROOT}/export?format=${format}&scope=all&lang=${activeLang}`;
    }
  } else {
    window.location.href = `${API_ROOT}/export?format=${format}&scope=all&lang=${activeLang}`;
  }
}

// ===================================
// 自选导出弹窗
// ===================================
let exportPickFormat = 'json';
let exportPickChecked = new Set();
let exportPickModalInstance = null;

function openExportPickModal(format) {
  exportPickFormat = format;
  exportPickChecked = new Set();

  if (!exportPickModalInstance) {
    const el = document.getElementById('exportPickModal');
    if (!el) { showToast('导出弹窗初始化失败', 'danger'); return; }
    exportPickModalInstance = new bootstrap.Modal(el);
  }

  renderExportPickTree();
  updateExportPickCount();

  const searchInput = document.getElementById('exportPickSearch');
  if (searchInput) searchInput.value = '';

  // 事件绑定（仅首次）
  const confirmBtn = document.getElementById('exportPickConfirmBtn');
  if (confirmBtn && !confirmBtn._bound) {
    confirmBtn._bound = true;
    confirmBtn.addEventListener('click', executeExportPick);
  }
  const selectAllBtn = document.getElementById('exportPickSelectAll');
  if (selectAllBtn && !selectAllBtn._bound) {
    selectAllBtn._bound = true;
    selectAllBtn.addEventListener('click', () => {
      allFolders.forEach(item => exportPickChecked.add(item.id));
      refreshExportPickCheckboxes();
      updateExportPickCount();
    });
  }
  const deselectAllBtn = document.getElementById('exportPickDeselectAll');
  if (deselectAllBtn && !deselectAllBtn._bound) {
    deselectAllBtn._bound = true;
    deselectAllBtn.addEventListener('click', () => {
      exportPickChecked.clear();
      refreshExportPickCheckboxes();
      updateExportPickCount();
    });
  }
  if (searchInput && !searchInput._bound) {
    searchInput._bound = true;
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => filterExportPickTree(searchInput.value.trim()), 200);
    });
  }

  exportPickModalInstance.show();
}

function renderExportPickTree() {
  const container = document.getElementById('exportPickTree');
  if (!container) return;
  container.innerHTML = '';

  if (!allFolders || allFolders.length === 0) {
    container.innerHTML = '<div class="export-pick-empty"><i class="fas fa-inbox"></i><p>暂无数据</p></div>';
    return;
  }

  const rootItems = allFolders.filter(i => !i.parent_id);
  if (rootItems.length === 0) {
    container.innerHTML = '<div class="export-pick-empty"><i class="fas fa-inbox"></i><p>暂无数据</p></div>';
    return;
  }
  rootItems.forEach(item => {
    container.appendChild(createExportPickNode(item, 0));
  });
}

function createExportPickNode(item, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'export-pick-node';
  wrapper.dataset.id = item.id;

  const row = document.createElement('label');
  row.className = 'export-pick-row';
  row.style.paddingLeft = (16 + depth * 22) + 'px';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'export-pick-checkbox';
  checkbox.dataset.id = item.id;
  checkbox.checked = exportPickChecked.has(item.id);
  checkbox.addEventListener('change', (e) => onExportPickToggle(item.id, e.target.checked));

  const icon = document.createElement('i');
  icon.className = getItemIcon(item) + ' ' + getIconColor(item);

  const name = document.createElement('span');
  name.className = 'export-pick-name';
  name.textContent = getDisplayName(item);

  const meta = document.createElement('span');
  meta.className = 'export-pick-meta';
  if (item.type === 'folder') {
    const childCount = allFolders.filter(c => c.parent_id === item.id).length;
    meta.textContent = `(${childCount} 项)`;
  } else if (item.format) {
    meta.textContent = item.format.toUpperCase();
  }

  row.appendChild(checkbox);
  row.appendChild(icon);
  row.appendChild(name);
  row.appendChild(meta);
  wrapper.appendChild(row);

  // 子项（只显示文件夹子项）
  const children = allFolders.filter(c => c.parent_id === item.id);
  if (children.length > 0) {
    const childContainer = document.createElement('div');
    childContainer.className = 'export-pick-children';
    children.forEach(child => {
      childContainer.appendChild(createExportPickNode(child, depth + 1));
    });
    wrapper.appendChild(childContainer);
  }

  return wrapper;
}

function onExportPickToggle(itemId, checked) {
  if (checked) {
    exportPickChecked.add(itemId);
    // 自动选中所有祖先（防呆：选子必选父）
    autoSelectAncestors(itemId);
  } else {
    exportPickChecked.delete(itemId);
    // 自动取消选中所有后代
    autoDeselectDescendants(itemId);
  }
  refreshExportPickCheckboxes();
  updateExportPickCount();
}

function autoSelectAncestors(itemId) {
  const item = findItemByIdAnywhere(itemId);
  if (!item || !item.parent_id) return;
  const seen = new Set();
  let parentId = item.parent_id;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    exportPickChecked.add(parentId);
    const parent = allFolders.find(i => i.id === parentId);
    parentId = parent ? parent.parent_id : null;
  }
}

function autoDeselectDescendants(itemId) {
  const children = allFolders.filter(i => i.parent_id === itemId);
  for (const child of children) {
    exportPickChecked.delete(child.id);
    autoDeselectDescendants(child.id);
  }
}

function refreshExportPickCheckboxes() {
  const checkboxes = document.querySelectorAll('.export-pick-checkbox');
  checkboxes.forEach(cb => {
    const id = parseInt(cb.dataset.id, 10);
    if (!isNaN(id)) cb.checked = exportPickChecked.has(id);
  });
}

function updateExportPickCount() {
  const countEl = document.getElementById('exportPickCount');
  if (countEl) countEl.textContent = exportPickChecked.size;
  const confirmBtn = document.getElementById('exportPickConfirmBtn');
  if (confirmBtn) confirmBtn.disabled = exportPickChecked.size === 0;
}

function filterExportPickTree(query) {
  const nodes = document.querySelectorAll('.export-pick-node');
  if (!query) {
    nodes.forEach(node => { node.style.display = ''; });
    return;
  }
  const lower = query.toLowerCase();
  // 找出匹配的 item id 及其所有祖先
  const matchIds = new Set();
  allFolders.forEach(item => {
    const itemName = getDisplayName(item).toLowerCase();
    const fmt = (item.format || '').toLowerCase();
    if (itemName.includes(lower) || fmt.includes(lower)) {
      matchIds.add(item.id);
      let pid = item.parent_id;
      const seen = new Set();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        matchIds.add(pid);
        const p = allFolders.find(i => i.id === pid);
        pid = p ? p.parent_id : null;
      }
    }
  });
  nodes.forEach(node => {
    const id = parseInt(node.dataset.id, 10);
    node.style.display = matchIds.has(id) ? '' : 'none';
  });
}

async function executeExportPick() {
  if (exportPickChecked.size === 0) {
    showToast('请至少选择一个项目', 'warning');
    return;
  }
  const ids = Array.from(exportPickChecked);
  try {
    const response = await fetch(`${API_ROOT}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: exportPickFormat, ids: ids })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showToast('导出失败：' + (err.error || '服务器错误'), 'danger');
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filenameMatch = disposition.match(/filename=([^;]+)/);
    const filename = filenameMatch ? filenameMatch[1].trim() : `export.${exportPickFormat}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast(`已导出 ${ids.length} 个项目`, 'success');
    if (exportPickModalInstance) exportPickModalInstance.hide();
  } catch (error) {
    console.error('导出失败:', error);
    showToast('导出失败：' + (error.message || '网络错误'), 'danger');
  }
}

async function importData() {
  const fileInput = document.getElementById('importFile');
  if (!fileInput.files.length) {
    showToast('请选择文件', 'warning');
    return;
  }
  try {
    const file = fileInput.files[0];
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      showToast('导入文件格式错误：需要 JSON 数组', 'danger');
      return;
    }

    // 检查是否有任何导入的文件夹或文件名称包含斜杠 "/"
    let hasSlash = false;
    for (const item of data) {
      if (item.name && item.name.includes('/')) {
        hasSlash = true;
        break;
      }
    }

    if (hasSlash) {
      const proceed = confirm('检测到要导入的数据中，有些文件或文件夹的名称包含斜杠字符 "/"。由于系统限制，名称中不能包含该字符。\n\n系统可自动将这些名称中的 "/" 替换为 "-" 以便继续导入。\n\n您是否要将 "/" 替换为 "-" 并继续导入？');
      if (!proceed) {
        return;
      }
      // 将所有名称中的 "/" 替换成 "-"
      for (const item of data) {
        if (item.name && item.name.includes('/')) {
          item.name = item.name.replace(/\//g, '-');
        }
      }
    }
    const response = await fetch(`${API_ROOT}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (response.ok) {
      const result = await response.json().catch(() => ({}));
      const count = result.imported || '未知数量';
      showToast(`✓ 导入成功，共导入 ${count} 个项目`, 'success');
      const importEl = document.getElementById('importModal');
      const importInst = importEl && bootstrap.Modal.getInstance(importEl);
      if (importInst) importInst.hide();
      loadAllData().catch(err => {
        console.error('重新加载数据失败:', err);
      });
    } else {
      const err = await response.json().catch(() => ({}));
      showToast('导入失败：' + (err.error || '服务器错误'), 'danger');
    }
  } catch (error) {
    showToast('导入失败：' + error.message, 'danger');
  }
}

// ===================================
// 统计信息
// ===================================
async function updateStats() {
  // 先展示文件夹数量（已有全量文件夹数据）
  document.getElementById('totalFolders').textContent = allFolders.length;
  document.getElementById('totalFiles').textContent = '...';

  // 从 API 获取完整统计
  try {
    const response = await fetch(`${API_ROOT}/stats`);
    if (!response.ok) return;
    const stats = await response.json();

    // 文件 / 文件夹数量
    document.getElementById('totalFiles').textContent   = stats.total_files   ?? 0;
    document.getElementById('totalFolders').textContent = stats.total_folders ?? allFolders.length;

    // 格式分布
    const formatStatsDiv = document.getElementById('formatStats');
    if (formatStatsDiv && stats.by_format) {
      formatStatsDiv.innerHTML = '';
      Object.entries(stats.by_format)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .forEach(([format, count]) => {
          const tag = document.createElement('span');
          tag.className = 'format-tag';
          tag.textContent = `${format} (${count})`;
          formatStatsDiv.appendChild(tag);
        });
    }

    // 存储概况
    const sizeDisplay  = document.getElementById('totalSizeDisplay');
    const sizedCount   = document.getElementById('sizedFileCount');
    const sizeByFormat = document.getElementById('sizeByFormat');
    if (sizeDisplay) sizeDisplay.textContent = stats.total_size_display || '0 B';
    if (sizedCount)  sizedCount.textContent  = t('recordedSizes', stats.sized_file_count || 0);

    if (sizeByFormat && stats.size_by_format) {
      const entries = Object.entries(stats.size_by_format);
      if (entries.length > 0) {
        const maxBytes = Math.max(...entries.map(([, v]) => v.bytes));
        sizeByFormat.innerHTML = entries.slice(0, 8).map(([fmt, data]) => {
          const pct = maxBytes > 0 ? Math.round((data.bytes / maxBytes) * 100) : 0;
          return `<div class="size-bar-row">
            <span class="size-bar-label">${escapeHtml(fmt)}</span>
            <div class="size-bar-track"><div class="size-bar-fill" style="width:${pct}%"></div></div>
            <span class="size-bar-value">${data.display}</span>
          </div>`;
        }).join('');
      } else {
        sizeByFormat.innerHTML = `<div class="text-muted" style="font-size:11px;">${t('noSizeData')}</div>`;
      }
    }
  } catch (e) {
    console.warn('获取统计信息失败:', e);
  }
}

// ===================================
// 本地批量导入
// ===================================
function openLocalImportModal(targetFolder = currentFolder) {
  hideContextMenu();
  localImportTargetFolder = targetFolder;
  if (!localImportModalInstance) {
    localImportModalInstance = new bootstrap.Modal(document.getElementById('localImportModal'));
  }
  resetLocalImportUI(true);
  localImportModalInstance.show();
}

function resetLocalImportUI(clearSelections = false) {
  if (clearSelections) {
    localImportState = {
      directoryFiles: [],
      looseFiles: [],
      directoryKeys: new Set(),
      looseKeys: new Set(),
      fsFolders: new Map(),
      fsFiles: new Map()
    };
    const baseInput = document.getElementById('localImportBasePath');
    if (baseInput) baseInput.value = '';
  }

  isProcessingLocalImport = false;

  const stageSelect = document.getElementById('localImportStageSelect');
  const stageProgress = document.getElementById('localImportStageProgress');
  const stageComplete = document.getElementById('localImportStageComplete');
  const selectionActions = document.getElementById('localImportSelectionActions');
  const confirmBtn = document.getElementById('localImportConfirmBtn');
  const statusEl = document.getElementById('localImportStatusText');
  const detailEl = document.getElementById('localImportDetailText');
  const progressBar = document.getElementById('localImportProgressBar');
  const closeBtn = document.getElementById('localImportCloseBtn');

  if (stageSelect) stageSelect.style.display = 'block';
  if (stageProgress) stageProgress.style.display = 'none';
  if (stageComplete) stageComplete.style.display = 'none';
  if (selectionActions) selectionActions.style.display = 'flex';
  if (confirmBtn) {
    confirmBtn.style.display = 'none';
    confirmBtn.disabled = false;
  }
  if (statusEl) {
    statusEl.textContent = t('preparingImport');
    statusEl.classList.remove('text-danger');
  }
  if (detailEl) detailEl.textContent = '';
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.textContent = '0%';
  }
  if (closeBtn) closeBtn.style.display = '';

  const startBtn = document.getElementById('localImportStartBtn');
  const selectCombinedBtn = document.getElementById('localImportSelectCombinedBtn');
  const resetBtn = document.getElementById('localImportResetBtn');
  [startBtn, selectCombinedBtn, resetBtn].forEach(btn => {
    if (btn) btn.disabled = false;
  });

  // 显示导入的目标路径
  const targetDisplayEl = document.getElementById('localImportTargetDisplay');
  if (targetDisplayEl) {
    if (localImportTargetFolder) {
      const pathStr = getManagementPath(localImportTargetFolder);
      const locStr = localImportTargetFolder.location ? ` (${localImportTargetFolder.location})` : '';
      targetDisplayEl.textContent = pathStr + locStr;
    } else {
      targetDisplayEl.textContent = `/${t('thisPC')}`;
    }
  }

  updateLocalImportSummary();
}

function updateLocalImportSummary() {
  const { folders, files } = computePreparedEntries();
  const listEl = document.getElementById('localImportSelectedItemsList');
  const noneTextEl = document.getElementById('localImportNoneSelectedText');
  const countBadgeEl = document.getElementById('localImportTotalCountBadge');

  const totalCount = folders.length + files.length;
  if (countBadgeEl) countBadgeEl.textContent = totalCount;

  const startBtn = document.getElementById('localImportStartBtn');
  if (startBtn) startBtn.disabled = totalCount === 0;

  if (!listEl) return;

  // 清空现有项
  listEl.innerHTML = '';

  if (totalCount === 0) {
    if (noneTextEl) {
      listEl.appendChild(noneTextEl);
      noneTextEl.style.display = 'block';
    } else {
      listEl.innerHTML = `<div class="text-center text-muted py-4" id="localImportNoneSelectedText">${t('selectedNone')}</div>`;
    }
    return;
  }

  const renderItem = (name, isFolder, typeExtension = null, onRemove) => {
    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between align-items-center mb-1 py-1 px-2 rounded hover-bg';
    row.style.fontSize = '13px';
    row.style.borderBottom = '1px solid rgba(0, 0, 0, 0.03)';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'd-inline-flex align-items-center';
    
    const icon = document.createElement('i');
    if (isFolder) {
      icon.className = 'fas fa-folder text-warning me-2';
    } else {
      const dummyItem = { type: 'file', format: typeExtension };
      icon.className = getItemIcon(dummyItem) + ' ' + getIconColor(dummyItem) + ' me-2';
    }

    iconSpan.appendChild(icon);
    
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    nameSpan.className = 'text-truncate d-inline-block';
    nameSpan.style.maxWidth = '300px';
    nameSpan.title = name;
    iconSpan.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-sm text-danger p-0 border-0 bg-transparent';
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.style.fontSize = '12px';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });

    row.appendChild(iconSpan);
    row.appendChild(removeBtn);
    return row;
  };

  // 渲染文件夹
  folders.forEach((folder) => {
    listEl.appendChild(renderItem(folder.name, true, null, () => removeLocalImportFolder(folder.path)));
  });

  // 渲染文件
  files.forEach((fileEntry) => {
    listEl.appendChild(renderItem(fileEntry.fileName, false, getFileExtension(fileEntry.fileName), () => removeLocalImportFile(fileEntry)));
  });
}

function removeLocalImportFolder(folderPath) {
  // 1. 从 fsFolders 和 fsFiles 中移除
  if (localImportState.fsFolders.has(folderPath)) {
    localImportState.fsFolders.delete(folderPath);
    for (const [p] of localImportState.fsFolders) {
      if (p === folderPath || p.startsWith(folderPath + '/')) {
        localImportState.fsFolders.delete(p);
      }
    }
    for (const [key, entry] of localImportState.fsFiles) {
      const fPath = entry.folderPath || '';
      if (fPath === folderPath || fPath.startsWith(folderPath + '/')) {
        localImportState.fsFiles.delete(key);
      }
    }
  }

  // 2. 从 directoryFiles 中过滤
  localImportState.directoryFiles = localImportState.directoryFiles.filter(file => {
    const relPath = file.webkitRelativePath || file.name;
    const parts = relPath.split('/').filter(Boolean);
    const folderSegments = folderPath.split('/').filter(Boolean);
    const startsWith = folderSegments.every((seg, idx) => parts[idx] === seg);
    if (startsWith) {
      const key = `${relPath}|${file.size}|${file.lastModified}`;
      localImportState.directoryKeys.delete(key);
      return false;
    }
    return true;
  });

  updateLocalImportSummary();
}

function removeLocalImportFile(fileEntry) {
  // 从 fsFiles 中移除
  const folderPath = fileEntry.folderPath || '';
  const key = `${folderPath}||${fileEntry.fileName}`;
  if (localImportState.fsFiles.has(key)) {
    localImportState.fsFiles.delete(key);
  }

  // 从 looseFiles / directoryFiles 中移除
  if (fileEntry.file) {
    const file = fileEntry.file;
    const lIndex = localImportState.looseFiles.indexOf(file);
    if (lIndex !== -1) {
      localImportState.looseFiles.splice(lIndex, 1);
      const lKey = `${file.name}|${file.size}|${file.lastModified}`;
      localImportState.looseKeys.delete(lKey);
    }
    const dIndex = localImportState.directoryFiles.indexOf(file);
    if (dIndex !== -1) {
      localImportState.directoryFiles.splice(dIndex, 1);
      const relPath = file.webkitRelativePath || file.name;
      const dKey = `${relPath}|${file.size}|${file.lastModified}`;
      localImportState.directoryKeys.delete(dKey);
    }
  }

  updateLocalImportSummary();
}

function isExternalDrag(e) {
  return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files');
}

async function handleExternalDrop(e, targetFolder, append = false) {
  e.preventDefault();
  e.stopPropagation();

  const items = e.dataTransfer.items;
  if (!items || items.length === 0) return;

  showToast(t('dropLoadingText'), 'info');

  if (!append) {
    resetLocalImportUI(true);
    localImportTargetFolder = targetFolder;
  } else if (!localImportTargetFolder) {
    localImportTargetFolder = targetFolder;
  }

  const entriesToProcess = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        entriesToProcess.push(entry);
      }
    }
  }

  try {
    for (const entry of entriesToProcess) {
      await traverseFileEntry(entry, []);
    }

    updateLocalImportSummary();

    const targetDisplayEl = document.getElementById('localImportTargetDisplay');
    if (targetDisplayEl) {
      if (localImportTargetFolder) {
        const pathStr = getManagementPath(localImportTargetFolder);
        const locStr = localImportTargetFolder.location ? ` (${localImportTargetFolder.location})` : '';
        targetDisplayEl.textContent = pathStr + locStr;
      } else {
        targetDisplayEl.textContent = `/${t('thisPC')}`;
      }
    }

    if (!localImportModalInstance) {
      localImportModalInstance = new bootstrap.Modal(document.getElementById('localImportModal'));
    }
    localImportModalInstance.show();
  } catch (err) {
    console.error('读取拖放资源失败:', err);
    showToast(t('dropErrorTitle') + ': ' + err.message, 'danger');
  }
}

async function traverseFileEntry(entry, parentSegments = []) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
    if (parentSegments.length === 0) {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (!localImportState.looseKeys.has(key)) {
        localImportState.looseFiles.push(file);
        localImportState.looseKeys.add(key);
      }
    } else {
      const folderPath = parentSegments.join('/');
      const key = `${folderPath}||${entry.name}`;
      if (!localImportState.fsFiles.has(key)) {
        localImportState.fsFiles.set(key, {
          file: file,
          folderPath: folderPath,
          fileName: entry.name,
          relPath: [...parentSegments, entry.name].join('/')
        });
      }
    }
  } else if (entry.isDirectory) {
    const currentSegments = [...parentSegments, entry.name];
    const path = currentSegments.join('/');
    const parentPath = parentSegments.join('/');

    if (!localImportState.fsFolders.has(path)) {
      localImportState.fsFolders.set(path, {
        name: entry.name,
        path,
        parentPath,
        depth: currentSegments.length
      });
    }

    const dirReader = entry.createReader();
    const readAllEntries = async () => {
      let allEntries = [];
      while (true) {
        const entries = await new Promise((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });
        if (entries.length === 0) break;
        allEntries.push(...entries);
      }
      return allEntries;
    };

    const entries = await readAllEntries();
    for (const subEntry of entries) {
      await traverseFileEntry(subEntry, currentSegments);
    }
  }
}

async function handleLocalDirectoryPick() {
  const fallbackToLegacyInput = () => {
    document.getElementById('localDirectoryInput').click();
  };

  if (typeof window.showDirectoryPicker !== 'function') {
    fallbackToLegacyInput();
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker();
    const aggregation = { folders: [], files: [], folderKeys: new Set() };
    await collectDirectoryEntries(dirHandle, [], aggregation);
    registerFsEntries(aggregation);
    updateLocalImportSummary();
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
      return;
    }
    if (error && error.name === 'SecurityError') {
      fallbackToLegacyInput();
      return;
    }
    console.error('读取文件夹失败:', error);
    showToast('读取文件夹失败', 'danger');
  }
}

async function collectDirectoryEntries(dirHandle, parentSegments, aggregation) {
  const currentSegments = [...parentSegments, dirHandle.name];
  const path = currentSegments.join('/');
  const parentPath = currentSegments.length > 1 ? currentSegments.slice(0, -1).join('/') : '';

  if (!aggregation.folderKeys.has(path)) {
    aggregation.folderKeys.add(path);
    aggregation.folders.push({
      name: dirHandle.name,
      path,
      parentPath,
      depth: currentSegments.length
    });
  }

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      await collectDirectoryEntries(handle, currentSegments, aggregation);
    } else if (handle.kind === 'file') {
      let fileObject = null;
      try {
        fileObject = await handle.getFile();
      } catch (err) {
        console.warn('无法读取文件对象:', err);
      }
      aggregation.files.push({
        file: fileObject,
        folderPath: path,
        fileName: name,
        relPath: `${path}/${name}`
      });
    }
  }
}

function registerFsEntries(aggregation) {
  aggregation.folders.forEach(folder => {
    if (!localImportState.fsFolders.has(folder.path)) {
      localImportState.fsFolders.set(folder.path, folder);
    }
  });

  aggregation.files.forEach(fileEntry => {
    const folderPath = fileEntry.folderPath || '';
    const key = `${folderPath}||${fileEntry.fileName}`;
    if (!localImportState.fsFiles.has(key)) {
      localImportState.fsFiles.set(key, fileEntry);
    }
  });
}

function handleLocalDirectorySelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  files.forEach(file => {
    const key = `${file.webkitRelativePath || file.name}|${file.size}|${file.lastModified}`;
    if (!localImportState.directoryKeys.has(key)) {
      localImportState.directoryFiles.push(file);
      localImportState.directoryKeys.add(key);
    }
  });
  updateLocalImportSummary();
  event.target.value = '';
}

function handleLocalFileSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  files.forEach(file => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (!localImportState.looseKeys.has(key)) {
      localImportState.looseFiles.push(file);
      localImportState.looseKeys.add(key);
    }
  });
  updateLocalImportSummary();
  event.target.value = '';
}

function computePreparedEntries() {
  const folderMap = new Map();
  const files = [];
  const fileKeys = new Set();

  localImportState.directoryFiles.forEach(file => {
    const relativeRaw = file.webkitRelativePath || file.name;
    if (!relativeRaw) return;
    const normalizedParts = relativeRaw.split('/').map(part => part.trim()).filter(Boolean);
    if (!normalizedParts.length) return;
    const fileName = normalizedParts.pop();
    const folderSegments = normalizedParts;
    let cumulative = '';
    folderSegments.forEach((segment, index) => {
      const trimmed = segment.trim();
      if (!trimmed) return;
      cumulative = cumulative ? `${cumulative}/${trimmed}` : trimmed;
      if (!folderMap.has(cumulative)) {
        const parentPath = index === 0 ? '' : folderSegments.slice(0, index).join('/');
        folderMap.set(cumulative, {
          name: trimmed,
          path: cumulative,
          parentPath,
          depth: index + 1
        });
      }
    });

    const folderPath = folderSegments.join('/');
    const key = `${folderPath}||${fileName}`;
    if (!fileKeys.has(key)) {
      fileKeys.add(key);
      files.push({
        file,
        folderPath,
        fileName,
        relPath: relativeRaw
      });
    }
  });

  localImportState.looseFiles.forEach(file => {
    const fileName = file.name.trim();
    const key = `||${fileName}`;
    if (!fileKeys.has(key)) {
      fileKeys.add(key);
      files.push({
        file,
        folderPath: '',
        fileName,
        relPath: file.name
      });
    }
  });

  localImportState.fsFolders.forEach(folder => {
    if (!folderMap.has(folder.path)) {
      folderMap.set(folder.path, {
        name: folder.name,
        path: folder.path,
        parentPath: folder.parentPath,
        depth: folder.depth || (folder.path ? folder.path.split('/').length : 1)
      });
    }
  });

  localImportState.fsFiles.forEach(entry => {
    const folderPath = entry.folderPath || '';
    const key = `${folderPath}||${entry.fileName}`;
    if (fileKeys.has(key)) return;
    fileKeys.add(key);
    files.push({
      file: entry.file || null,
      folderPath,
      fileName: entry.fileName,
      relPath: entry.relPath || (folderPath ? `${folderPath}/${entry.fileName}` : entry.fileName)
    });
  });

  const folders = Array.from(folderMap.values()).sort((a, b) => {
    const depthA = a.depth || (a.path ? a.path.split('/').length : 1);
    const depthB = b.depth || (b.path ? b.path.split('/').length : 1);
    if (depthA === depthB) {
      return a.path.localeCompare(b.path);
    }
    return depthA - depthB;
  });

  return { folders, files };
}

async function startLocalImport() {
  if (isProcessingLocalImport) return;
  const { folders, files } = computePreparedEntries();
  if (!folders.length && !files.length) {
    showToast('请先选择文件或文件夹', 'warning');
    return;
  }

  // 检查是否有任何导入的文件夹或文件名称包含斜杠 "/"
  let hasSlash = false;
  for (const folder of folders) {
    if (folder.name.includes('/')) {
      hasSlash = true;
      break;
    }
  }
  if (!hasSlash) {
    for (const item of files) {
      const name = getFileNameWithoutExtension(item.fileName);
      if (name.includes('/') || item.fileName.includes('/')) {
        hasSlash = true;
        break;
      }
    }
  }

  if (hasSlash) {
    const proceed = confirm('检测到要导入的本地资源中，有些文件夹或文件的名称包含斜杠字符 "/"。由于系统限制，名称中不能包含该字符。\n\n系统可自动将这些名称中的 "/" 替换为 "-" 以便继续导入。\n\n您是否要将 "/" 替换为 "-" 并继续导入？');
    if (!proceed) {
      return;
    }
    // 将所有名称中的 "/" 替换成 "-"
    folders.forEach(folder => {
      if (folder.name.includes('/')) {
        folder.name = folder.name.replace(/\//g, '-');
      }
    });
    files.forEach(item => {
      if (item.fileName.includes('/')) {
        item.fileName = item.fileName.replace(/\//g, '-');
      }
    });
  }

  const baseInput = document.getElementById('localImportBasePath');
  const manualBase = baseInput ? baseInput.value.trim() : '';
  const autoBase = manualBase ? '' : detectAutoBasePath(localImportState.directoryFiles);
  const normalizedBase = normalizeBasePathInput(manualBase || autoBase);
  const baseDisplay = manualBase || autoBase;

  const totalOperations = folders.length + files.length;
  const progress = { completed: 0, total: totalOperations };
  const folderIdMap = new Map();
  const virtualItems = allItems.slice();
  const stats = { createdFolders: 0, skippedFolders: 0, createdFiles: 0, skippedFiles: 0 };
  const metadataStats = {
    linkResolved: 0,
    linkUnparsed: 0,
    resolvedSamples: [],
    unresolvedSamples: [],
    unreadableCount: 0,
    unreadableSamples: []
  };

  enterLocalImportProgressStage();

  try {
    for (const folder of folders) {
      const parentId = folder.parentPath ? resolveParentIdFromPath(folder.parentPath, folderIdMap, virtualItems) : (localImportTargetFolder ? localImportTargetFolder.id : null);
      const existing = findExistingItem(folder.name, parentId, 'folder', virtualItems);
      let folderId;
      let detailMessage;

      if (existing) {
        folderId = existing.id;
        stats.skippedFolders += 1;
        detailMessage = `文件夹已存在：${folder.name}`;
      } else {
        const payload = {
          name: folder.name,
          type: 'folder',
          description: null,
          location: buildPhysicalLocation(normalizedBase, folder.path, null),
          format: null,
          parent_id: parentId
        };
        folderId = await createRemoteItem(payload);
        stats.createdFolders += 1;
        virtualItems.push({ ...payload, id: folderId });
        detailMessage = `创建文件夹：${folder.name}`;
      }

      folderIdMap.set(folder.path, folderId);
      progress.completed += 1;
      updateLocalImportProgress(progress, detailMessage);
    }

    for (const item of files) {
      const parentId = item.folderPath ? resolveParentIdFromPath(item.folderPath, folderIdMap, virtualItems) : (localImportTargetFolder ? localImportTargetFolder.id : null);
      const fullFileName = item.fileName;
      const name = getFileNameWithoutExtension(fullFileName);
      const format = getFileExtension(fullFileName);
      const location = buildPhysicalLocation(normalizedBase, item.folderPath, fullFileName);
      const existing = findExistingItem(name, parentId, 'file', virtualItems, format);
      let detailMessage;

      if (existing) {
        stats.skippedFiles += 1;
        detailMessage = `文件已存在：${fullFileName}`;
      } else {
        // Read file.size from File API (read-only)
        const fileSizeValue = item.file && item.file.size ? String(item.file.size) : null;
        const payload = {
          name,
          type: 'file',
          description: null,
          location,
          format: format || null,
          parent_id: parentId,
          file_size: fileSizeValue
        };
        await enrichFilePayloadWithMetadata(item, payload, location, metadataStats);
        if (!payload.format) delete payload.format;
        const newId = await createRemoteItem(payload);
        stats.createdFiles += 1;
        virtualItems.push({ ...payload, id: newId, format: payload.format || null });
        detailMessage = `创建文件：${fullFileName}`;
      }

      progress.completed += 1;
      updateLocalImportProgress(progress, detailMessage);
    }

  updateLocalImportProgress({ completed: totalOperations, total: totalOperations }, '导入完成');
  showLocalImportCompletion(stats, baseDisplay, metadataStats);
    showToast('✓ 导入完成', 'success');
    await loadAllData().catch(err => console.error('重新加载数据失败:', err));
  } catch (error) {
    console.error('本地导入失败:', error);
    const statusEl = document.getElementById('localImportStatusText');
    const detailEl = document.getElementById('localImportDetailText');
    if (statusEl) {
      statusEl.textContent = '导入过程中出现错误';
      statusEl.classList.add('text-danger');
    }
    if (detailEl) {
      detailEl.textContent = error && error.message ? error.message : '未知错误';
    }
    const selectionActions = document.getElementById('localImportSelectionActions');
    if (selectionActions) selectionActions.style.display = 'none';
    const confirmBtn = document.getElementById('localImportConfirmBtn');
    if (confirmBtn) {
      confirmBtn.style.display = 'inline-flex';
      confirmBtn.disabled = false;
    }
    const closeBtn = document.getElementById('localImportCloseBtn');
    if (closeBtn) closeBtn.style.display = '';
    showToast('导入失败', 'danger');
    isProcessingLocalImport = false;
  }
}

function enterLocalImportProgressStage() {
  const stageSelect = document.getElementById('localImportStageSelect');
  const stageProgress = document.getElementById('localImportStageProgress');
  const selectionActions = document.getElementById('localImportSelectionActions');
  const closeBtn = document.getElementById('localImportCloseBtn');
  if (stageSelect) stageSelect.style.display = 'none';
  if (stageProgress) stageProgress.style.display = 'block';
  if (selectionActions) selectionActions.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'none';
  isProcessingLocalImport = true;
}

function updateLocalImportProgress(progress, detail) {
  const percent = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  const progressBar = document.getElementById('localImportProgressBar');
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${percent}%`;
  }
  const statusEl = document.getElementById('localImportStatusText');
  if (statusEl) statusEl.textContent = `正在导入（${progress.completed}/${progress.total}）`;
  const detailEl = document.getElementById('localImportDetailText');
  if (detailEl && detail) detailEl.textContent = detail;
}

function showLocalImportCompletion(stats, baseDisplay, metadataStats) {
  const stageProgress = document.getElementById('localImportStageProgress');
  const stageComplete = document.getElementById('localImportStageComplete');
  const selectionActions = document.getElementById('localImportSelectionActions');
  const confirmBtn = document.getElementById('localImportConfirmBtn');
  const closeBtn = document.getElementById('localImportCloseBtn');
  const summaryEl = document.getElementById('localImportSummaryText');

  if (stageProgress) stageProgress.style.display = 'none';
  if (stageComplete) stageComplete.style.display = 'block';
  if (selectionActions) selectionActions.style.display = 'none';
  if (confirmBtn) {
    confirmBtn.style.display = 'inline-flex';
    confirmBtn.disabled = false;
  }
  if (closeBtn) closeBtn.style.display = '';

  if (summaryEl) {
    let summaryHtml = `<div>新建文件夹：${stats.createdFolders}</div>` +
      `<div>新建文件：${stats.createdFiles}</div>`;
    if (stats.skippedFolders || stats.skippedFiles) {
      summaryHtml += `<div class="text-muted mt-2">已跳过已存在的项目：文件夹 ${stats.skippedFolders} 个，文件 ${stats.skippedFiles} 个。</div>`;
    }
    if (baseDisplay) {
      summaryHtml += `<div class="text-muted mt-2">物理路径基准：${escapeHtml(baseDisplay)}</div>`;
    }
    const metadataSummary = generateMetadataSummaryHtml(metadataStats);
    if (metadataSummary) {
      summaryHtml += `<div class="mt-2">${metadataSummary}</div>`;
    }
    summaryEl.innerHTML = summaryHtml;
  }

  localImportState = {
    directoryFiles: [],
    looseFiles: [],
    directoryKeys: new Set(),
    looseKeys: new Set(),
    fsFolders: new Map(),
    fsFiles: new Map()
  };
  isProcessingLocalImport = false;
}

async function createRemoteItem(payload) {
  const response = await fetch(`${API_ROOT}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data && data.error ? data.error : (response.statusText || '服务器错误');
    throw new Error(message);
  }

  if (!data || data.id === undefined) {
    throw new Error('服务器返回数据异常');
  }
  return data.id;
}

function findExistingItem(name, parentId, type, items, format = null) {
  const normalizedParent = parentId === undefined ? null : parentId;
  return items.find(item => item.type === type &&
    item.name === name &&
    ((item.parent_id ?? null) === (normalizedParent ?? null)) &&
    (type !== 'file' || ((item.format || null) === (format || null))));
}

function resolveParentIdFromPath(path, folderIdMap, items) {
  if (!path) return localImportTargetFolder ? localImportTargetFolder.id : null;
  const segments = path.split('/').filter(Boolean);
  let cumulative = '';
  let parentId = localImportTargetFolder ? localImportTargetFolder.id : null;

  for (const segment of segments) {
    cumulative = cumulative ? `${cumulative}/${segment}` : segment;
    if (folderIdMap.has(cumulative)) {
      parentId = folderIdMap.get(cumulative);
      continue;
    }
    const existing = findExistingItem(segment, parentId, 'folder', items);
    if (!existing) {
      return parentId;
    }
    folderIdMap.set(cumulative, existing.id);
    parentId = existing.id;
  }

  return parentId;
}

function getFileNameWithoutExtension(fileName) {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return fileName;
  return fileName.slice(0, index);
}

function getFileExtension(fileName) {
  const index = fileName.lastIndexOf('.');
  if (index <= 0 || index === fileName.length - 1) return null;
  return fileName.slice(index + 1).toLowerCase();
}

function normalizeBasePathInput(basePath) {
  if (!basePath) return '';
  let value = basePath.trim();
  if (!value) return '';
  value = value.replace(/\//g, '\\');
  value = value.replace(/\\{2,}/g, '\\');
  if (/^[A-Za-z]:$/.test(value)) {
    return value;
  }
  return value.replace(/\\$/, '');
}

function buildPhysicalLocation(basePath, folderPath, fileName) {
  const segments = folderPath ? folderPath.split('/').filter(Boolean) : [];
  const parts = [];
  if (basePath) {
    parts.push(basePath);
  }
  if (segments.length) {
    parts.push(segments.join('\\'));
  }
  let combined = parts.join('\\').replace(/\\{2,}/g, '\\');
  if (!combined && !fileName) {
    return '';
  }
  if (fileName) {
    combined = combined ? `${combined}\\${fileName}` : fileName;
  }
  return combined;
}

function detectAutoBasePath(directoryFiles) {
  for (const file of directoryFiles) {
    if (file.path && file.webkitRelativePath) {
      const fullPath = file.path.replace(/\//g, '\\');
      const relative = file.webkitRelativePath.replace(/\//g, '\\');
      if (fullPath.toLowerCase().endsWith(relative.toLowerCase())) {
        return fullPath.slice(0, fullPath.length - relative.length).replace(/\\+$/, '');
      }
    }
  }
  return '';
}

// ===================================
// 工具函数
// ===================================
function getDisplayName(item) {
  if (!item) return '';
  const baseName = item.name || '';
  if (item.type === 'file' && item.format) {
    const suffix = `.${item.format}`;
    if (baseName.toLowerCase().endsWith(suffix.toLowerCase())) {
      return baseName;
    }
    return `${baseName}${suffix}`;
  }
  return baseName;
}

function appendDescriptionLine(description, label, value) {
  if (value === null || value === undefined) {
    return description ?? null;
  }
  const stringValue = String(value).trim();
  if (!stringValue) {
    return description ?? null;
  }
  const safeLabel = (label || '').trim();
  const line = safeLabel ? `${safeLabel}: ${stringValue}` : stringValue;
  if (description && description.includes(line)) {
    return description;
  }
  return description ? `${description}\n${line}` : line;
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function formatLocationHtml(location) {
  if (!location) {
    return '未设置';
  }
  const trimmed = location.trim();
  if (!trimmed) {
    return '未设置';
  }
  if (isHttpUrl(trimmed)) {
    const safeText = escapeHtml(trimmed);
    return `<a href="${safeText}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
  }
  return escapeHtml(trimmed);
}

async function enrichFilePayloadWithMetadata(item, payload, physicalLocation, metadataStats) {
  if (!item || !payload) return;
  const formatValue = (payload.format || '').toLowerCase();
  const linkFormats = ['url', 'website', 'desktop', 'webloc'];
  const shortcutFormats = ['lnk'];
  const fileObject = item.file || null;
  const fileNameForLog = item.fileName || payload.name || '未命名';
  const physical = physicalLocation || '';

  if (!fileObject) {
    if (linkFormats.includes(formatValue) || shortcutFormats.includes(formatValue)) {
      metadataStats.unreadableCount += 1;
      if (metadataStats.unreadableSamples.length < 5) {
        metadataStats.unreadableSamples.push(fileNameForLog);
      }
      if (linkFormats.includes(formatValue)) {
        metadataStats.linkUnparsed += 1;
        if (metadataStats.unresolvedSamples.length < 5) {
          metadataStats.unresolvedSamples.push(fileNameForLog);
        }
        payload.description = appendDescriptionLine(payload.description, '备注', '浏览器限制：未能解析网页快捷方式目标');
      } else if (shortcutFormats.includes(formatValue)) {
        metadataStats.linkUnparsed += 1;
        if (metadataStats.unresolvedSamples.length < 5) {
          metadataStats.unresolvedSamples.push(fileNameForLog);
        }
        payload.description = appendDescriptionLine(payload.description, '备注', '浏览器限制：未能读取快捷方式目标');
      }
    }
    return;
  }

  if (linkFormats.includes(formatValue)) {
    const text = await readFileTextSafely(fileObject);
    const resolved = formatValue === 'webloc' ? extractUrlFromWebloc(text) : extractUrlFromIniLike(text);
    if (resolved) {
      payload.location = resolved;
      if (physical && physical !== resolved) {
        payload.description = appendDescriptionLine(payload.description, '原始磁盘路径', physical);
      }
      metadataStats.linkResolved += 1;
      if (metadataStats.resolvedSamples.length < 5) {
        metadataStats.resolvedSamples.push(fileNameForLog);
      }
    } else {
      metadataStats.linkUnparsed += 1;
      if (metadataStats.unresolvedSamples.length < 5) {
        metadataStats.unresolvedSamples.push(fileNameForLog);
      }
      if (physical && payload.location !== physical) {
        payload.description = appendDescriptionLine(payload.description, '原始磁盘路径', physical);
      }
      payload.description = appendDescriptionLine(payload.description, '备注', '未能解析网页快捷方式目标');
    }
    return;
  }

  if (shortcutFormats.includes(formatValue)) {
    metadataStats.linkUnparsed += 1;
    if (metadataStats.unresolvedSamples.length < 5) {
      metadataStats.unresolvedSamples.push(fileNameForLog);
    }
    if (physical && payload.location !== physical) {
      payload.description = appendDescriptionLine(payload.description, '原始磁盘路径', physical);
    }
    payload.description = appendDescriptionLine(payload.description, '备注', 'Windows 快捷方式，未解析目标');
  }
}

async function readFileTextSafely(fileObject, maxBytes = 512 * 1024) {
  try {
    if (fileObject.size > maxBytes) {
      return null;
    }
    return await fileObject.text();
  } catch (error) {
    console.warn('读取文件内容失败:', error);
    return null;
  }
}

function extractUrlFromIniLike(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.toLowerCase().startsWith('url=')) {
      const candidate = line.slice(4).trim();
      if (candidate) {
        return candidate;
      }
    }
  }
  return null;
}

function extractUrlFromWebloc(text) {
  if (!text) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      return null;
    }
    const urlNodes = doc.getElementsByTagName('string');
    for (let i = 0; i < urlNodes.length; i++) {
      const value = urlNodes[i].textContent ? urlNodes[i].textContent.trim() : '';
      if (value) {
        return value;
      }
    }
    const keyNodes = doc.getElementsByTagName('key');
    for (let i = 0; i < keyNodes.length; i++) {
      if (keyNodes[i].textContent === 'URL') {
        const sibling = keyNodes[i].nextElementSibling;
        if (sibling && sibling.tagName && sibling.tagName.toLowerCase() === 'string') {
          const candidate = sibling.textContent ? sibling.textContent.trim() : '';
          if (candidate) {
            return candidate;
          }
        }
      }
    }
  } catch (error) {
    console.warn('解析 webloc 文件失败:', error);
  }
  return null;
}

function generateMetadataSummaryHtml(metadataStats) {
  if (!metadataStats) return '';
  const segments = [];
  if (metadataStats.linkResolved) {
    let line = `解析网页快捷方式成功 ${metadataStats.linkResolved} 个（位置已替换为目标链接）`;
    if (metadataStats.resolvedSamples.length) {
      line += `，示例：${metadataStats.resolvedSamples.slice(0, 3).join('、')}`;
    }
    segments.push(line);
  }
  if (metadataStats.linkUnparsed) {
    let line = `未能解析的快捷方式 ${metadataStats.linkUnparsed} 个（已作为普通文件导入）`;
    if (metadataStats.unresolvedSamples.length) {
      line += `，示例：${metadataStats.unresolvedSamples.slice(0, 3).join('、')}`;
    }
    segments.push(line);
  }
  if (metadataStats.unreadableCount) {
    let line = `浏览器限制导致 ${metadataStats.unreadableCount} 个文件无法读取内容`;
    if (metadataStats.unreadableSamples.length) {
      line += `，示例：${metadataStats.unreadableSamples.slice(0, 3).join('、')}`;
    }
    segments.push(line);
  }
  if (!segments.length) {
    return '';
  }
  return segments.map(text => `<div>${escapeHtml(text)}</div>`).join('');
}

function getItemIcon(item) {
  if (item.type === 'folder') return 'fas fa-folder';
  if (!item.format) return 'fas fa-file';
  const format = item.format.toLowerCase();
  if (['url', 'webloc', 'website', 'desktop', 'lnk'].includes(format)) return 'fas fa-link';
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(format)) return 'fas fa-file-video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'].includes(format)) return 'fas fa-file-audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(format)) return 'fas fa-file-image';
  if (['pdf', 'doc', 'docx', 'txt', 'rtf'].includes(format)) return 'fas fa-file-alt';
  if (['xls', 'xlsx', 'csv'].includes(format)) return 'fas fa-file-excel';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(format)) return 'fas fa-file-archive';
  if (['js', 'py', 'java', 'cpp', 'html', 'css', 'php'].includes(format)) return 'fas fa-file-code';
  return 'fas fa-file';
}

function getIconColor(item) {
  if (item.type === 'folder') return 'text-folder';
  if (!item.format) return 'text-file';
  const format = item.format.toLowerCase();
  if (['url', 'webloc', 'website', 'desktop', 'lnk'].includes(format)) return 'text-link';
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(format)) return 'text-video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'].includes(format)) return 'text-audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(format)) return 'text-image';
  if (['pdf', 'doc', 'docx', 'txt', 'rtf'].includes(format)) return 'text-document';
  if (['xls', 'xlsx', 'csv'].includes(format)) return 'text-document';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(format)) return 'text-archive';
  if (['js', 'py', 'java', 'cpp', 'html', 'css', 'php'].includes(format)) return 'text-file';
  return 'text-file';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const iconMap = { success: 'fa-check-circle', danger: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
  const icon = iconMap[type] || iconMap.info;
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.innerHTML = `<i class="fas ${icon}"></i><span>${escapeHtml(message)}</span><button class="toast-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
  container.appendChild(toast);
  // Trigger reflow for animation
  toast.offsetHeight;
  toast.classList.add('toast-show');
  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// ===================================
// 本地磁盘浏览器 (自定义多选)
// ===================================
let currentLocalPickerPath = '';
let localPickerModalInstance = null;

function openLocalPickerModal() {
  if (!localPickerModalInstance) {
    localPickerModalInstance = new bootstrap.Modal(document.getElementById('localPickerModal'));
  }
  localPickerModalInstance.show();
  loadLocalPickerDirectory('');
}

async function loadLocalPickerDirectory(path) {
  const listEl = document.getElementById('localPickerItemsList');
  const pathInput = document.getElementById('localPickerPathInput');
  const upBtn = document.getElementById('localPickerUpBtn');
  const selectAllCheckbox = document.getElementById('localPickerSelectAll');
  
  if (selectAllCheckbox) selectAllCheckbox.checked = false;
  if (listEl) listEl.innerHTML = '<tr><td colspan="4" class="text-center py-4"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading...</td></tr>';
  
  try {
    const response = await fetch(`${API_ROOT}/local/list?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '无法读取该目录');
    }
    const data = await response.json();
    currentLocalPickerPath = data.current_path;
    
    if (pathInput) pathInput.value = currentLocalPickerPath;
    
    if (upBtn) {
      upBtn.dataset.parent = data.parent_path;
      upBtn.disabled = data.current_path === '' || data.parent_path === undefined;
    }
    
    // 渲染左侧驱动器列表
    await populateSidebarDrives();

    if (!listEl) return;
    listEl.innerHTML = '';
    
    // 更新共 N 个项目状态
    const statusInfo = document.getElementById('localPickerStatusInfo');
    if (statusInfo) {
      statusInfo.textContent = t('totalItems', data.items.length);
    }
    
    // 更新选择数状态为 0
    updateLocalPickerSelectionCount();
    
    if (data.items.length === 0) {
      listEl.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">空目录</td></tr>';
      return;
    }
    
    data.items.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      
      const tdCheck = document.createElement('td');
      tdCheck.style.textAlign = 'center';
      tdCheck.style.verticalAlign = 'middle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'local-picker-item-checkbox form-check-input';
      checkbox.dataset.path = item.path;
      checkbox.dataset.type = item.type;
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        updateLocalPickerSelectionCount();
      });
      checkbox.addEventListener('change', () => {
        updateLocalPickerSelectionCount();
      });
      tdCheck.appendChild(checkbox);
      
      const tdName = document.createElement('td');
      tdName.className = 'text-truncate';
      tdName.style.maxWidth = '480px';
      tdName.style.verticalAlign = 'middle';
      const icon = document.createElement('i');
      if (item.type === 'folder') {
        icon.className = 'fas fa-folder text-warning me-2';
      } else {
        const dummyItem = { type: 'file', format: getFileExtension(item.name) };
        icon.className = getItemIcon(dummyItem) + ' ' + getIconColor(dummyItem) + ' me-2';
      }
      tdName.appendChild(icon);
      
      const nameText = document.createTextNode(item.name);
      tdName.appendChild(nameText);
      
      // 双击文件夹进入，双击文件勾选
      tr.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (item.type === 'folder') {
          loadLocalPickerDirectory(item.path);
        } else {
          checkbox.checked = !checkbox.checked;
          updateLocalPickerSelectionCount();
        }
      });
      
      // 单击行勾选/取消勾选
      tr.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        updateLocalPickerSelectionCount();
      });
      
      const tdType = document.createElement('td');
      tdType.style.verticalAlign = 'middle';
      tdType.textContent = item.type === 'folder' ? t('folders') : (item.type === 'file' ? t('filesUnit') : item.type);
      
      const tdSize = document.createElement('td');
      tdSize.style.textAlign = 'right';
      tdSize.style.paddingRight = '20px';
      tdSize.style.verticalAlign = 'middle';
      tdSize.textContent = item.size !== null && item.size !== undefined ? formatFileSize(item.size) : '-';
      
      tr.appendChild(tdCheck);
      tr.appendChild(tdName);
      tr.appendChild(tdType);
      tr.appendChild(tdSize);
      listEl.appendChild(tr);
    });
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-4"><i class="fas fa-exclamation-circle me-1"></i> 读取失败: ${escapeHtml(err.message)}</td></tr>`;
    }
    showToast('读取磁盘失败: ' + err.message, 'danger');
  }
}

async function populateSidebarDrives() {
  const sidebar = document.getElementById('localPickerSidebarDrives');
  if (!sidebar) return;
  try {
    const response = await fetch(`${API_ROOT}/local/list?path=`);
    if (!response.ok) return;
    const data = await response.json();
    sidebar.innerHTML = '';
    data.items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'sidebar-picker-item';
      
      const isPathActive = currentLocalPickerPath === item.path || currentLocalPickerPath.startsWith(item.path);
      if (isPathActive) {
        div.classList.add('active');
      }
      
      div.innerHTML = `<i class="fas fa-hdd ${isPathActive ? 'text-primary' : 'text-secondary'}"></i><span>${item.name}</span>`;
      div.addEventListener('click', (e) => {
        e.stopPropagation();
        loadLocalPickerDirectory(item.path);
      });
      sidebar.appendChild(div);
    });
  } catch (err) {
    console.warn('Failed to load sidebar drives:', err);
  }
}

function updateLocalPickerSelectionCount() {
  const count = document.querySelectorAll('.local-picker-item-checkbox:checked').length;
  const countEl = document.getElementById('localPickerSelectionCount');
  if (countEl) {
    countEl.textContent = t('localPickerSelectedCount', count);
  }
}

async function handleLocalPickerConfirm() {
  const checkboxes = document.querySelectorAll('.local-picker-item-checkbox:checked');
  if (checkboxes.length === 0) {
    showToast('请至少选择一个项目', 'warning');
    return;
  }
  
  const checkedPaths = Array.from(checkboxes).map(cb => cb.dataset.path);
  
  showToast(t('preparingImport'), 'info');
  
  try {
    const response = await fetch(`${API_ROOT}/local/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: checkedPaths,
        base_path: currentLocalPickerPath
      })
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '解析路径失败');
    }
    
    const data = await response.json();
    
    const baseInput = document.getElementById('localImportBasePath');
    if (baseInput && !baseInput.value.trim() && data.base_path) {
      baseInput.value = data.base_path;
    }
    
    registerFsEntries(data);
    updateLocalImportSummary();
    
    if (localPickerModalInstance) {
      localPickerModalInstance.hide();
    }
    
    showToast(`✓ 已成功添加 ${data.folders.length + data.files.length} 个本地资源到导入列表中`, 'success');
  } catch (err) {
    console.error('解析本地资源失败:', err);
    showToast('添加资源失败: ' + err.message, 'danger');
  }
}
