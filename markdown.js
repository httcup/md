/* 轻量 Markdown 渲染：先转义原文，再按语法拼 HTML，输出里不会有任何用户可执行的标签。 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var SAFE_URL = /^(?:https?:\/\/|mailto:|#|\/(?!\/)|\.{1,2}\/)/i;

  function safeUrl(u) {
    var s = String(u || '').trim();
    return SAFE_URL.test(s) ? s : '';
  }

  /* 行内语法：代码 → 图片 → 链接 → 粗体 → 斜体 → 删除线 → 自动链接 → 换行 */
  function inline(raw) {
    var codes = [];
    var text = String(raw).replace(/(`+)([\s\S]*?)\1/g, function (m, ticks, code) {
      codes.push(code);
      return '\u0000' + (codes.length - 1) + '\u0000';
    });

    text = esc(text);

    text = text.replace(/!\[([^\]]*)\]\(([^)\s]*)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, alt, url) {
      var u = safeUrl(url);
      if (!u) return m;
      return '<a class="md-img" href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' +
        (alt || '图片') + '</a>';
    });

    text = text.replace(/\[([^\]]+)\]\(([^)\s]*)(?:\s+&quot;[^&]*&quot;)?\)/g, function (m, label, url) {
      var u = safeUrl(url);
      if (!u) return label + ' (' + url + ')';
      return '<a href="' + u + '" target="_blank" rel="noopener noreferrer nofollow">' + label + '</a>';
    });

    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w])_([^_\n]+)_(?![\w])/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer nofollow">' + url + '</a>';
    });

    text = text.replace(/\n/g, '<br>');

    return text.replace(/\u0000(\d+)\u0000/g, function (m, n) {
      return '<code>' + esc(codes[+n]) + '</code>';
    });
  }

  var LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  var HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
  var HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  var FENCE = /^\s{0,3}(```|~~~)\s*([\w+#.-]*)\s*$/;
  var QUOTE = /^\s{0,3}>\s?(.*)$/;
  var TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

  function isBlockStart(line) {
    return HEADING.test(line) || FENCE.test(line) || HR.test(line) || QUOTE.test(line) || LIST_ITEM.test(line);
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (c) { return c.trim(); });
  }

  function parseList(lines, start) {
    var first = LIST_ITEM.exec(lines[start]);
    var baseIndent = first[1].length;
    var ordered = /\d/.test(first[2]);
    var html = '<' + (ordered ? 'ol' : 'ul') + (ordered ? ' start="' + parseInt(first[2], 10) + '"' : '') + '>';
    var i = start;

    while (i < lines.length) {
      var m = LIST_ITEM.exec(lines[i]);
      if (!m) break;
      var indent = m[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) break;

      var body = m[3];
      var task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(body);
      var checked = '';
      if (task) {
        checked = '<input type="checkbox" disabled' + (task[1] === ' ' ? '' : ' checked') + '> ';
        body = task[2];
      }
      i++;

      var nested = '';
      while (i < lines.length) {
        var deeper = LIST_ITEM.exec(lines[i]);
        if (deeper && deeper[1].length >= baseIndent + 2) {
          var sub = parseList(lines, i);
          nested += sub.html;
          i = sub.i;
        } else {
          break;
        }
      }

      html += '<li>' + checked + inline(body) + nested + '</li>';
    }

    return { html: html + '</' + (ordered ? 'ol' : 'ul') + '>', i: i };
  }

  function parseTable(lines, start) {
    var head = splitRow(lines[0 + start]);
    var i = start + 2;
    var rows = [];
    while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim()) {
      rows.push(splitRow(lines[i]));
      i++;
    }
    var html = '<div class="md-table-wrap"><table><thead><tr>';
    head.forEach(function (c) { html += '<th>' + inline(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>';
      head.forEach(function (_, idx) { html += '<td>' + inline(r[idx] || '') + '</td>'; });
      html += '</tr>';
    });
    return { html: html + '</tbody></table></div>', i: i };
  }

  function render(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      var fence = FENCE.exec(line);
      if (fence) {
        var fenceMark = fence[1];
        var lang = fence[2];
        var buf = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(fenceMark) !== 0) {
          buf.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        out.push('<pre class="md-pre"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') +
          '><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      var h = HEADING.exec(line);
      if (h) {
        var level = h[1].length;
        out.push('<h' + level + '>' + inline(h[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      if (HR.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      if (QUOTE.test(line)) {
        var quote = [];
        while (i < lines.length && QUOTE.test(lines[i])) {
          quote.push(QUOTE.exec(lines[i])[1]);
          i++;
        }
        out.push('<blockquote>' + render(quote.join('\n')) + '</blockquote>');
        continue;
      }

      if (LIST_ITEM.test(line)) {
        var list = parseList(lines, i);
        out.push(list.html);
        i = list.i;
        continue;
      }

      if (line.indexOf('|') !== -1 && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        var table = parseTable(lines, i);
        out.push(table.html);
        i = table.i;
        continue;
      }

      var para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) {
        if (para.length && (HEADING.test(lines[i]) || FENCE.test(lines[i]) || HR.test(lines[i]) ||
            QUOTE.test(lines[i]) || LIST_ITEM.test(lines[i]))) break;
        para.push(lines[i]);
        i++;
      }
      out.push('<p>' + inline(para.join('\n')) + '</p>');
    }

    return out.join('\n');
  }

  /* 侧边列表用的纯文本摘要（去掉标记，截断） */
  function plain(src, limit) {
    var text = String(src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^[#>\s*-]+/gm, '')
      .replace(/[*_~`|]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    return limit && text.length > limit ? text.slice(0, limit) + '…' : text;
  }

  global.MDNotes = { render: render, inline: inline, plain: plain, escape: esc };
})(window);
