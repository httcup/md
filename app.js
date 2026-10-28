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
  var usageEl = $('usage');
  var pinBtn = $('pin');
  var trashBtn = $('trashBtn');
  var trashOpsEl = $('trashOps');

  var data = { notes: [], trash: [], cur: null };
  var trashMode = false;
  var saveTimer = null;
  var listTimer = null;
  var toastTimer = null;

  var TRASH_DAYS = 30;

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
    '> 「下载 .md」存当前这本，「备份 JSON」能原样备份和恢复，删除的笔记在「回收站」躺 30 天。',
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
    return data.notes.slice().sort(function (a, b) {
      var pa = a.pinned ? 1 : 0;
      var pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (b.updated || 0) - (a.updated || 0);
    });
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
    /* 文件名里不能有冒号（macOS/Windows 都不允许），时间用 - 代替 */
    var d = new Date();
    var ts = String(d.getFullYear()).slice(2) + '年' + (d.getMonth() + 1) + '月' + d.getDate() +
      '日 ' + pad(d.getHours()) + '-' + pad(d.getMinutes());
    return (base || '未命名笔记') + '-' + ts + '.md';
  }

  /* 每本笔记前的分隔标记：HTML 注释在 Markdown 里不可见，正文里写 --- 不会误切 */
  var NOTE_MARK = '<!-- mdnotes-note -->';

  /* 识别「备份全部」生成的合并文件，只按 NOTE_MARK 标记拆分，不做 --- 兜底 */
  function splitBackup(text) {
    var t = String(text || '').replace(/^\uFEFF/, '');
    if (t.indexOf(NOTE_MARK) === -1) return null;
    var parts = t.split(NOTE_MARK)
      .map(function (s) { return s.replace(/^\s+|\s+$/g, ''); })
      .filter(Boolean);
    return parts.map(function (part) {
      var m = part.match(/^#\s+(.+)/);
      if (m) {
        return { title: m[1].trim(), body: part.slice(m[0].length).replace(/^\s+/, '') };
      }
      return { title: '', body: part };
    });
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

  /* 状态栏显示存储占用（localStorage 上限约 5MB），超过八成变红提醒 */
  function updateUsage() {
    if (!usageEl) return;
    var s = '';
    try {
      s = JSON.stringify({ v: 1, cur: data.cur, notes: data.notes, trash: data.trash });
    } catch (e) { return; }
    var bytes;
    try { bytes = new Blob([s]).size; } catch (e) { bytes = s.length; }
    var quota = 5 * 1024 * 1024;
    var pct = bytes / quota;
    var label = bytes < 1024 ? bytes + ' B'
      : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB'
      : (bytes / 1048576).toFixed(2) + ' MB';
    usageEl.textContent = '存储 ' + label + (pct > 0.6 ? ' · 快满了，记得备份' : '');
    usageEl.classList.toggle('is-warn', pct > 0.8);
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

  function normalizeNote(n) {
    return {
      id: String(n.id),
      title: String(n.title || ''),
      body: String(n.body || ''),
      created: +n.created || Date.now(),
      updated: +n.updated || Date.now(),
      pinned: !!n.pinned
    };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }

    if (raw) {
      try {
        var saved = JSON.parse(raw);
        if (saved && Array.isArray(saved.notes) && saved.notes.length) {
          data.notes = saved.notes.filter(function (n) {
            return n && typeof n.id === 'string';
          }).map(normalizeNote);
          data.cur = saved.cur;
        }
        if (saved && Array.isArray(saved.trash)) {
          data.trash = saved.trash.filter(function (n) {
            return n && typeof n.id === 'string';
          }).map(function (n) {
            var m = normalizeNote(n);
            m.deletedAt = +n.deletedAt || Date.now();
            return m;
          });
        }
      } catch (e) { /* 坏数据就当作空，不覆盖用户历史 */ }
    }

    purgeOldTrash();
    if (!data.notes.length) seed();
    if (!find(data.cur)) data.cur = sorted()[0].id;
  }

  /* 回收站里超过 30 天的自动清掉 */
  function purgeOldTrash() {
    var cutoff = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
    var keep = data.trash.filter(function (n) { return (n.deletedAt || 0) >= cutoff; });
    if (keep.length !== data.trash.length) data.trash = keep;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, cur: data.cur, notes: data.notes, trash: data.trash }));
      setState('已保存 ' + clock(Date.now()));
      updateUsage();
    } catch (e) {
      setState('无法保存');
      toast('浏览器拒绝了本地存储，记得「备份 JSON」留一份');
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

    if (trashMode) {
      data.trash.slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); })
        .forEach(function (n) {
          if (q) {
            var hay = (n.title + ' ' + n.body).toLowerCase();
            if (hay.indexOf(q) === -1) return;
          }
          shown++;

          var li = document.createElement('li');
          var item = document.createElement('div');
          item.className = 'nb-note nb-trash-item';

          var t = document.createElement('span');
          t.className = 'nb-note-t';
          t.textContent = derivedTitle(n);

          var m = document.createElement('span');
          m.className = 'nb-note-m';
          m.textContent = countChars(n.body) + ' 字 · ' + stamp(n.deletedAt) + ' 删除';

          var ops = document.createElement('span');
          ops.className = 'nb-trash-ops';
          var restoreBtn = document.createElement('button');
          restoreBtn.type = 'button';
          restoreBtn.textContent = '恢复';
          restoreBtn.dataset.restore = n.id;
          var purgeBtn = document.createElement('button');
          purgeBtn.type = 'button';
          purgeBtn.textContent = '彻底删除';
          purgeBtn.dataset.purge = n.id;
          ops.appendChild(restoreBtn);
          ops.appendChild(purgeBtn);

          item.appendChild(t);
          item.appendChild(m);
          item.appendChild(ops);
          li.appendChild(item);
          listEl.appendChild(li);
        });

      emptyEl.hidden = shown > 0;
      emptyEl.textContent = q ? '回收站里没有匹配「' + qEl.value.trim() + '」的笔记' : '回收站是空的';
      if (trashOpsEl) trashOpsEl.hidden = data.trash.length === 0;
      if (trashBtn) trashBtn.textContent = '返回笔记';
      return;
    }

    if (trashOpsEl) trashOpsEl.hidden = true;
    if (trashBtn) {
      trashBtn.textContent = data.trash.length ? '回收站（' + data.trash.length + '）' : '回收站';
    }

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
      btn.title = '点击打开 · 右键复制一份';

      var t = document.createElement('span');
      t.className = 'nb-note-t';
      t.textContent = (n.pinned ? '📌 ' : '') + derivedTitle(n);

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
    if (pinBtn) pinBtn.setAttribute('aria-pressed', String(!!n.pinned));
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
    persist();
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
    flush();

    var order = sorted();
    var idx = order.findIndex(function (x) { return x.id === n.id; });
    n.deletedAt = Date.now();
    data.notes = data.notes.filter(function (x) { return x.id !== n.id; });
    data.trash.push(n);

    if (!data.notes.length) {
      newNote();
      toast('已移入回收站，30 天内可在「回收站」找回');
      return;
    }
    var next = order[idx + 1] || order[idx - 1];
    data.cur = next.id;
    paint();
    persist();
    toast('已移入回收站，30 天内可找回');
  }

  function restoreNote(id) {
    var i = data.trash.findIndex(function (x) { return x.id === id; });
    if (i === -1) return;
    var n = data.trash.splice(i, 1)[0];
    delete n.deletedAt;
    data.notes.push(n);
    if (trashMode) {
      trashMode = false;
      if (trashBtn) trashBtn.setAttribute('aria-pressed', 'false');
    }
    data.cur = n.id;
    qEl.value = '';
    paint();
    persist();
    toast('已恢复「' + derivedTitle(n) + '」');
  }

  function purgeNote(id) {
    var n = null;
    for (var i = 0; i < data.trash.length; i++) {
      if (data.trash[i].id === id) { n = data.trash[i]; break; }
    }
    if (!n) return;
    if (!window.confirm('彻底删除「' + derivedTitle(n) + '」？删掉就真的找不回来了。')) return;
    data.trash = data.trash.filter(function (x) { return x.id !== id; });
    renderList();
    persist();
    toast('已彻底删除');
  }

  function emptyTrash() {
    if (!data.trash.length) { toast('回收站是空的'); return; }
    if (!window.confirm('彻底删除回收站里的 ' + data.trash.length + ' 本笔记？删掉就真的找不回来了。')) return;
    data.trash = [];
    renderList();
    persist();
    toast('回收站已清空');
  }

  function togglePin() {
    var n = cur();
    if (!n) return;
    n.pinned = !n.pinned;
    paint();
    persist();
    toast(n.pinned ? '已置顶，会一直排在列表最上面' : '已取消置顶');
  }

  function duplicateNote(id) {
    var n = find(id);
    if (!n) return;
    flush();
    var copy = {
      id: uid(),
      title: n.title ? n.title + '（副本）' : '',
      body: n.body,
      created: Date.now(),
      updated: Date.now(),
      pinned: n.pinned
    };
    data.notes.push(copy);
    data.cur = copy.id;
    paint();
    persist();
    toast('已复制一份「' + derivedTitle(copy) + '」');
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
    /* 文件头也放一个标记，这样哪怕只备份了一本也能正确拆分 */
    download(name, [NOTE_MARK].concat(parts).join('\n\n' + NOTE_MARK + '\n\n') + '\n');
    toast('已备份 ' + data.notes.length + ' 本笔记');
  }

  /* JSON 备份：.md 给人看，JSON 负责机器原样还原（含创建/修改时间、置顶） */
  function backupJSON() {
    flush();
    var payload = {
      app: 'mdnotes',
      v: 1,
      exported: new Date().toISOString(),
      notes: sorted().map(function (n) {
        return {
          id: n.id,
          title: n.title,
          body: n.body,
          created: n.created,
          updated: n.updated,
          pinned: !!n.pinned
        };
      })
    };
    var d = new Date();
    var name = '笔记备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    download(name, JSON.stringify(payload, null, 2));
    toast('已备份 JSON（含时间，可原样恢复）');
  }

  /* 识别 JSON 备份文件，原样还原 id / 标题 / 时间 / 置顶 */
  function restoreJSON(text) {
    var t = String(text || '').replace(/^\uFEFF/, '').trim();
    if (t.charAt(0) !== '{') return null;
    var obj;
    try { obj = JSON.parse(t); } catch (e) { return null; }
    if (!obj || !Array.isArray(obj.notes)) return null;
    var existing = {};
    data.notes.forEach(function (n) { existing[n.id] = true; });
    return obj.notes.filter(function (n) {
      return n && typeof n.body === 'string';
    }).map(function (n) {
      var id = (n.id && typeof n.id === 'string' && !existing[n.id]) ? n.id : uid();
      return {
        id: id,
        title: String(n.title || ''),
        body: String(n.body || ''),
        created: +n.created || Date.now(),
        updated: +n.updated || Date.now(),
        pinned: !!n.pinned
      };
    });
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
        var name = f.name || '未命名.md';
        /* JSON 备份原样还原（含时间、置顶） */
        var restored = restoreJSON(text);
        if (restored && restored.length) return restored;
        /* 备份文件（含 NOTE_MARK 标记）先拆回多本笔记 */
        var split = splitBackup(text);
        if (split && split.length) {
          return split.map(function (p) {
            return {
              id: uid(),
              title: p.title,
              body: p.body,
              created: Date.now(),
              updated: Date.now()
            };
          });
        }
        return [{
          id: uid(),
          title: name.replace(/\.[^.]+$/, ''),
          body: text.replace(/^\uFEFF/, ''),
          created: Date.now(),
          updated: Date.now()
        }];
      });
    })).then(function (groups) {
      var notes = [];
      groups.forEach(function (g) { notes = notes.concat(g); });
      notes.forEach(function (n) { data.notes.push(n); });
      data.cur = notes[0].id;
      qEl.value = '';
      paint();
      persist();
      toast('已导入 ' + notes.length + ' 篇笔记');
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

  /* 列表项识别：缩进 + 标记（- * + 或 1. 1)）+ 可选待办方括号 + 内容 */
  var LIST_PREFIX = /^([ \t]*)([-*+]|(\d+)([.)]))([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;

  function lineAt(v, caret) {
    var start = v.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
    var end = v.indexOf('\n', caret);
    if (end === -1) end = v.length;
    return { start: start, end: end, text: v.slice(start, caret) };
  }

  /* 回车自动续列表：在列表项末尾回车补上前缀；空前缀行回车则退出列表 */
  function continueList() {
    var s = srcEl.selectionStart;
    var epos = srcEl.selectionEnd;
    if (s !== epos) return false;
    var v = srcEl.value;
    var line = lineAt(v, s);
    var m = LIST_PREFIX.exec(line.text);
    if (!m) return false;
    var content = m[7] || '';

    if (!content.trim() && s === line.end) {
      /* 整行只有前缀（光标在行尾）：清掉它，退出列表 */
      srcEl.value = v.slice(0, line.start) + m[1] + v.slice(line.end);
      var caretOut = line.start + m[1].length;
      srcEl.setSelectionRange(caretOut, caretOut);
      srcEl.focus();
      syncFromEditor();
      return true;
    }

    var marker = m[3] ? (parseInt(m[3], 10) + 1) + m[4] : m[2];
    var task = m[6] ? '[ ] ' : '';
    insertAtCaret('\n' + m[1] + marker + ' ' + task);
    return true;
  }

  /* Tab / Shift+Tab：多行或列表行整体缩进 / 反缩进两个空格 */
  function indentBlock(outdent) {
    var s = srcEl.selectionStart;
    var epos = srcEl.selectionEnd;
    var v = srcEl.value;
    var start = v.lastIndexOf('\n', Math.max(0, s - 1)) + 1;
    var end = v.indexOf('\n', epos);
    if (end === -1) end = v.length;
    var block = v.slice(start, end);
    var lines = block.split('\n').map(function (l) {
      return outdent ? l.replace(/^[ \t]{1,2}/, '') : '  ' + l;
    });
    var out = lines.join('\n');
    srcEl.value = v.slice(0, start) + out + v.slice(end);
    var delta = out.length - block.length;
    srcEl.setSelectionRange(Math.max(start, s + delta), Math.max(start, epos + delta));
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
    var r = e.target.closest('button[data-restore]');
    if (r) { restoreNote(r.dataset.restore); return; }
    var p = e.target.closest('button[data-purge]');
    if (p) { purgeNote(p.dataset.purge); return; }
    if (trashMode) return;
    var btn = e.target.closest('.nb-note');
    if (btn) select(btn.dataset.id, false);
  });

  /* 列表里右键（手机长按）复制一份 */
  listEl.addEventListener('contextmenu', function (e) {
    var btn = e.target.closest('.nb-note');
    if (!btn || trashMode) return;
    e.preventDefault();
    duplicateNote(btn.dataset.id);
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

    if (e.key === 'Enter' && !e.shiftKey && !meta && !e.altKey) {
      if (continueList()) { e.preventDefault(); return; }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        indentBlock(true);
      } else if (srcEl.selectionStart !== srcEl.selectionEnd ||
          LIST_PREFIX.test(lineAt(srcEl.value, srcEl.selectionStart).text)) {
        indentBlock(false);
      } else {
        insertAtCaret('  ');
      }
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
  if (pinBtn) pinBtn.addEventListener('click', togglePin);
  var exportJsonBtn = $('exportJson');
  if (exportJsonBtn) exportJsonBtn.addEventListener('click', backupJSON);
  if (trashBtn) {
    trashBtn.addEventListener('click', function () {
      trashMode = !trashMode;
      trashBtn.setAttribute('aria-pressed', String(trashMode));
      renderList();
    });
  }
  var emptyTrashBtn = $('emptyTrash');
  if (emptyTrashBtn) emptyTrashBtn.addEventListener('click', emptyTrash);
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

  /* 双标签页同步：另一个标签页写入时，把它的数据接过来，避免互相覆盖 */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    var remote = null;
    try { remote = JSON.parse(e.newValue); } catch (err) { return; }
    if (!remote || !Array.isArray(remote.notes)) return;

    /* 本地有还没落盘的修改时以最后写入的为准：放弃本地待存内容，接住远端 */
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    data.notes = remote.notes.filter(function (n) {
      return n && typeof n.id === 'string';
    }).map(normalizeNote);
    data.trash = (Array.isArray(remote.trash) ? remote.trash : []).filter(function (n) {
      return n && typeof n.id === 'string';
    }).map(function (n) {
      var m = normalizeNote(n);
      m.deletedAt = +n.deletedAt || Date.now();
      return m;
    });
    if (!data.notes.length) seed();
    if (!find(data.cur)) data.cur = sorted()[0].id;
    trashMode = false;
    if (trashBtn) trashBtn.setAttribute('aria-pressed', 'false');
    paint();
  });

  window.addEventListener('beforeunload', function () {
    persist();
  });

  /* ---------- 启动 ---------- */

  load();
  paint();
  applyUi();
  updateUsage();
  if (!data.notes.length) newNote();
})();
