/* 笔记存为 .md —— 多笔记、自动保存、导入导出，全部在本地完成。 */
(function () {
  'use strict';

  var KEY = 'mdnotes.v1';
  var $ = function (id) { return document.getElementById(id); };

  var listEl = $('noteList');
  var emptyEl = $('noteEmpty');
  var titleEl = $('title');
  var srcEl = $('src');
  var prevEl = $('prev');
  var readEl = document.querySelector('.nb-read');
  var prevEmpty = $('prevEmpty');
  var stateEl = $('state');
  var statEl = $('stat');
  var splitEl = $('split');
  var qEl = $('q');
  var toastEl = $('toast');

  var data = { notes: [], cur: null };
  var saveTimer = null;
  var listTimer = null;
  var toastTimer = null;

  var WELCOME = [
    '# 欢迎，这是一块本地记事板',
    '',
    '左边写，右边就是最终的样子。每敲一句都会自动存在这台设备的浏览器里，关掉页面再回来还在。',
    '',
    '## 可以这么用',
    '',
    '- [ ] 记待办，导出 .md 丢进仓库',
    '- [ ] 写草稿，写完再粘到别处',
    '- [x] 试试顶栏的「下载 .md」',
    '',
    '## 语法速查',
    '',
    '| 想要 | 写法 |',
    '| --- | --- |',
    '| 标题 | `# 一级标题` |',
    '| 粗体 | `**粗体**` |',
    '| 列表 | `- 项目` |',
    '| 引用 | `> 引用` |',
    '| 链接 | `[名字](https://example.com)` |',
    '',
    '> 「下载 .md」把当前这本存成文件，「备份全部」把所有笔记合成一份。',
    '',
    '```js',
    "// 代码块原样保留",
    "const hello = '你好';",
    '```',
    '',
    '写累了就点右上角「删除」，或者干脆新建一本重新开始。'
  ].join('\n');

  /* ---------- 基础工具 ---------- */

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function cur() {
    for (var i = 0; i < data.notes.length; i++) {
      if (data.notes[i].id === data.cur) return data.notes[i];
    }
    return null;
  }

  function find(id) {
    for (var i = 0; i < data.notes.length; i++) {
      if (data.notes[i].id === id) return data.notes[i];
    }
    return null;
  }

  function sorted() {
    return data.notes.slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function clock(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function stamp(ts) {
    var d = new Date(ts);
    var today = new Date();
    if (d.toDateString() === today.toDateString()) return '今天 ' + clock(ts);
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + clock(ts);
  }

  function countChars(s) {
    return String(s || '').replace(/\s+/g, '').length;
  }

  function derivedTitle(note) {
    var t = (note.title || '').trim();
    if (t) return t;
    var first = String(note.body || '').split('\n').map(function (l) {
      return l.replace(/^#{1,6}\s*/, '').replace(/^[-*+>]\s*/, '').trim();
    }).filter(Boolean)[0];
    if (first) return window.MDNotes.plain(first, 28);
    return '无标题笔记';
  }

  function fileName(note) {
    var base = derivedTitle(note)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return (base || '未命名笔记') + '.md';
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 1700);
  }

  function setState(text) {
    stateEl.textContent = text;
  }

  /* ---------- 存取 ---------- */

  function seed() {
    data.notes = [{
      id: uid(),
      title: '欢迎使用',
      body: WELCOME,
      created: Date.now(),
      updated: Date.now()
    }];
    data.cur = data.notes[0].id;
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }

    if (raw) {
      try {
        var saved = JSON.parse(raw);
        if (saved && saved.notes && saved.notes.length) {
          data.notes = saved.notes.filter(function (n) {
            return n && typeof n.id === 'string';
          }).map(function (n) {
            return {
              id: n.id,
              title: String(n.title || ''),
              body: String(n.body || ''),
              created: n.created || Date.now(),
              updated: n.updated || Date.now()
            };
          });
          data.cur = saved.cur;
        }
      } catch (e) { /* 坏数据就当作空，不覆盖用户历史 */ }
    }

    if (!data.notes.length) seed();
    if (!find(data.cur)) data.cur = sorted()[0].id;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, cur: data.cur, notes: data.notes }));
      setState('已保存 ' + clock(Date.now()));
    } catch (e) {
      setState('无法保存');
      toast('浏览器拒绝了本地存储，记得下载 .md 留一份');
    }
  }

  function markDirty() {
    setState('保存中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persist();
    }, 400);
  }

  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persist();
  }

  /* ---------- 渲染 ---------- */

  function renderList() {
    var q = qEl.value.trim().toLowerCase();
    listEl.textContent = '';
    var shown = 0;

    sorted().forEach(function (n) {
      if (q) {
        var hay = (n.title + ' ' + n.body).toLowerCase();
        if (hay.indexOf(q) === -1) return;
      }
      shown++;

      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nb-note';
      btn.dataset.id = n.id;
      btn.setAttribute('aria-current', n.id === data.cur ? 'true' : 'false');

      var t = document.createElement('span');
      t.className = 'nb-note-t';
      t.textContent = derivedTitle(n);

      var m = document.createElement('span');
      m.className = 'nb-note-m';
      m.textContent = countChars(n.body) + ' 字 · ' + stamp(n.updated);

      btn.appendChild(t);
      btn.appendChild(m);
      li.appendChild(btn);
      listEl.appendChild(li);
    });

    emptyEl.hidden = shown > 0;
    emptyEl.textContent = q ? '没有匹配「' + qEl.value.trim() + '」的笔记' : '还没有笔记，点上面「新建笔记」';
  }

  function scheduleList() {
    if (listTimer) return;
    listTimer = setTimeout(function () {
      listTimer = null;
      renderList();
    }, 220);
  }

  function renderPreview() {
    var text = srcEl.value;
    if (!text.trim()) {
      prevEl.innerHTML = '';
      prevEmpty.hidden = false;
      return;
    }
    prevEmpty.hidden = true;
    prevEl.innerHTML = window.MDNotes.render(text);
  }

  function updateStat() {
    var body = srcEl.value;
    var lines = body ? body.split('\n').length : 1;
    statEl.textContent = countChars(body) + ' 字 · ' + lines + ' 行';
  }

  function paint() {
    var n = cur();
    if (!n) return;
    titleEl.value = n.title;
    srcEl.value = n.body;
    renderPreview();
    updateStat();
    srcEl.scrollTop = 0;
    if (readEl) readEl.scrollTop = 0;
    renderList();
    setState('已保存 ' + clock(n.updated));
  }

  function select(id, focusEditor) {
    if (!find(id)) return;
    flush();
    data.cur = id;
    paint();
    if (focusEditor) {
      srcEl.focus();
      var end = srcEl.value.length;
      srcEl.setSelectionRange(end, end);
    }
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, cur: data.cur, notes: data.notes })); } catch (e) {}
  }

  function newNote() {
    var n = {
      id: uid(),
      title: '',
      body: '',
      created: Date.now(),
      updated: Date.now()
    };
    flush();
    data.notes.push(n);
    data.cur = n.id;
    qEl.value = '';
    paint();
    titleEl.focus();
    toast('新建了一本笔记');
  }

  function removeNote() {
    var n = cur();
    if (!n) return;
    if (data.notes.length <= 1) {
      toast('至少留一本笔记；想清空内容可以全选删掉');
      return;
    }
    if (!window.confirm('删除「' + derivedTitle(n) + '」？删掉就找不回来了。')) return;

    var order = sorted();
    var idx = order.findIndex(function (x) { return x.id === n.id; });
    data.notes = data.notes.filter(function (x) { return x.id !== n.id; });
    var next = order[idx + 1] || order[idx - 1] || data.notes[0];
    data.cur = next.id;
    paint();
    persist();
    toast('已删除');
  }

  /* ---------- 导入导出 ---------- */

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function downloadCurrent() {
    var n = cur();
    if (!n) return;
    flush();
    download(fileName(n), n.body);
    toast('已下载 ' + fileName(n));
  }

  function backupAll() {
    flush();
    var parts = sorted().map(function (n) {
      var body = String(n.body || '').replace(/^\s+|\s+$/g, '');
      var head = '# ' + derivedTitle(n);
      if (/^#{1,6}\s/.test(body)) return body;
      return body ? head + '\n\n' + body : head;
    });
    var d = new Date();
    var name = '笔记备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.md';
    download(name, parts.join('\n\n---\n\n') + '\n');
    toast('已备份 ' + data.notes.length + ' 本笔记');
  }

  function copyCurrent() {
    var text = srcEl.value;
    if (!text) { toast('还没有内容可复制'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast('已复制 Markdown');
      }, function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    toast(ok ? '已复制 Markdown' : '复制失败，请手动选中');
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file, 'utf-8');
    });
  }

  function importFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    flush();

    Promise.all(list.map(function (f) {
      return readFile(f).then(function (text) {
        var name = (f.name || '未命名').replace(/\.[^.]+$/, '');
        return {
          id: uid(),
          title: name,
          body: text.replace(/^\uFEFF/, ''),
          created: Date.now(),
          updated: Date.now()
        };
      });
    })).then(function (notes) {
      notes.forEach(function (n) { data.notes.push(n); });
      data.cur = notes[0].id;
      qEl.value = '';
      paint();
      persist();
      toast('已导入 ' + notes.length + ' 个文件');
    }).catch(function () {
      toast('读取失败，换一个文件试试');
    });
  }

  /* ---------- 编辑辅助 ---------- */

  function syncFromEditor() {
    var n = cur();
    if (!n) return;
    n.body = srcEl.value;
    n.updated = Date.now();
    markDirty();
    renderPreview();
    updateStat();
    syncScroll();
    scheduleList();
  }

  /* 编辑框滚动时，预览按比例跟随（用户反馈：预览不跟手） */
  function syncScroll() {
    if (!readEl) return;
    var sh = srcEl.scrollHeight - srcEl.clientHeight;
    var ratio = sh > 0 ? srcEl.scrollTop / sh : 0;
    readEl.scrollTop = ratio * (readEl.scrollHeight - readEl.clientHeight);
  }

  function insertAtCaret(text) {
    var s = srcEl.selectionStart;
    var e = srcEl.selectionEnd;
    var v = srcEl.value;
    srcEl.value = v.slice(0, s) + text + v.slice(e);
    var caret = s + text.length;
    srcEl.setSelectionRange(caret, caret);
    srcEl.focus();
    syncFromEditor();
  }

  function wrapSelection(before, after, hint) {
    var s = srcEl.selectionStart;
    var e = srcEl.selectionEnd;
    var v = srcEl.value;
    var sel = v.slice(s, e) || hint || '';
    srcEl.value = v.slice(0, s) + before + sel + after + v.slice(e);
    srcEl.setSelectionRange(s + before.length, s + before.length + sel.length);
    srcEl.focus();
    syncFromEditor();
  }

  function prefixLines(marker, hint) {
    var s = srcEl.selectionStart;
    var e = srcEl.selectionEnd;
    var v = srcEl.value;
    var start = v.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
    var end = v.indexOf('\n', e);
    if (end === -1) end = v.length;
    var block = v.slice(start, end) || hint || '';
    var out = block.split('\n').map(function (line) { return marker + line; }).join('\n');
    srcEl.value = v.slice(0, start) + out + v.slice(end);
    srcEl.setSelectionRange(start + marker.length, start + out.length);
    srcEl.focus();
    syncFromEditor();
  }

  function linkFromSelection() {
    var s = srcEl.selectionStart;
    var e = srcEl.selectionEnd;
    var v = srcEl.value;
    var sel = v.slice(s, e) || '链接文字';
    var md = '[' + sel + '](https://)';
    srcEl.value = v.slice(0, s) + md + v.slice(e);
    var urlStart = s + sel.length + 3;
    srcEl.setSelectionRange(urlStart, urlStart + 8);
    srcEl.focus();
    syncFromEditor();
  }

  var TOOLBAR = {
    h2: function () { prefixLines('## ', '小标题'); },
    h3: function () { prefixLines('### ', '小标题'); },
    bold: function () { wrapSelection('**', '**', '粗体'); },
    italic: function () { wrapSelection('*', '*', '斜体'); },
    strike: function () { wrapSelection('~~', '~~', '删除线'); },
    code: function () { wrapSelection('`', '`', '代码'); },
    ul: function () { prefixLines('- ', '列表项'); },
    ol: function () { prefixLines('1. ', '列表项'); },
    task: function () { prefixLines('- [ ] ', '待办'); },
    quote: function () { prefixLines('> ', '引用'); },
    link: linkFromSelection,
    table: function () {
      insertAtCaret('\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n');
    },
    codeblock: function () { wrapSelection('```\n', '\n```', '代码'); },
    hr: function () { insertAtCaret('\n\n---\n\n'); }
  };

  /* ---------- 界面折叠（左侧列表 / 右侧预览） ---------- */

  var UIKEY = 'mdnotes.ui.v1';
  var appEl = document.querySelector('.nb-app');
  var sideToggle = $('sideToggle');
  var prevToggle = $('prevToggle');
  var ui = { side: true, prev: true };

  try {
    var savedUi = JSON.parse(localStorage.getItem(UIKEY) || 'null');
    if (savedUi && typeof savedUi.side === 'boolean' && typeof savedUi.prev === 'boolean') {
      ui = savedUi;
    }
  } catch (e) { /* 状态坏了就当默认展开 */ }

  function applyUi() {
    appEl.classList.toggle('side-hidden', !ui.side);
    splitEl.classList.toggle('prev-hidden', !ui.prev);
    sideToggle.setAttribute('aria-pressed', String(ui.side));
    prevToggle.setAttribute('aria-pressed', String(ui.prev));
    try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch (e) {}
  }

  sideToggle.addEventListener('click', function () {
    ui.side = !ui.side;
    applyUi();
  });

  prevToggle.addEventListener('click', function () {
    ui.prev = !ui.prev;
    applyUi();
    if (ui.prev) renderPreview();
  });

  /* ---------- 事件绑定 ---------- */

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.nb-note');
    if (btn) select(btn.dataset.id, false);
  });

  titleEl.addEventListener('input', function () {
    var n = cur();
    if (!n) return;
    n.title = titleEl.value;
    n.updated = Date.now();
    markDirty();
    scheduleList();
  });

  srcEl.addEventListener('input', syncFromEditor);
  srcEl.addEventListener('scroll', syncScroll, { passive: true });

  srcEl.addEventListener('keydown', function (e) {
    var meta = e.metaKey || e.ctrlKey;
    var key = (e.key || '').toLowerCase();

    if (meta && key === 's') {
      e.preventDefault();
      flush();
      toast('已保存');
      return;
    }
    if (meta && key === 'b') { e.preventDefault(); TOOLBAR.bold(); return; }
    if (meta && key === 'i') { e.preventDefault(); TOOLBAR.italic(); return; }
    if (meta && key === 'k') { e.preventDefault(); linkFromSelection(); return; }

    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCaret('  ');
    }
  });

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 's') {
      e.preventDefault();
      flush();
      toast('已保存');
    }
  });

  $('toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-md]');
    if (!b) return;
    var fn = TOOLBAR[b.dataset.md];
    if (fn) fn();
  });

  $('newNote').addEventListener('click', newNote);
  $('download').addEventListener('click', downloadCurrent);
  $('copy').addEventListener('click', copyCurrent);
  $('remove').addEventListener('click', removeNote);
  $('exportAll').addEventListener('click', backupAll);
  $('importBtn').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function (e) {
    importFiles(e.target.files);
    e.target.value = '';
  });

  qEl.addEventListener('input', renderList);

  Array.prototype.forEach.call(document.querySelectorAll('.nb-view'), function (btn) {
    btn.addEventListener('click', function () {
      splitEl.dataset.view = btn.dataset.view;
      Array.prototype.forEach.call(document.querySelectorAll('.nb-view'), function (b) {
        var on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      if (btn.dataset.view === 'write') srcEl.focus();
    });
  });

  window.addEventListener('beforeunload', function () {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, cur: data.cur, notes: data.notes })); } catch (e) {}
  });

  /* ---------- 启动 ---------- */

  load();
  paint();
  applyUi();
  if (!data.notes.length) newNote();
})();
