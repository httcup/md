/* 极简二维码生成（byte 模式、M 级纠错、版本 1–13，最长约 330 字节）：纯本地计算，不发任何请求。
   只用到一个公开接口：window.MDQr.svg(文本) → 可直接塞进 DOM 的 <svg> 字符串。 */
(function (global) {
  'use strict';

  /* ---------- GF(256) 运算 ---------- */

  function mul(a, b) {
    var r = 0;
    while (b) {
      if (b & 1) r ^= a;
      b >>= 1;
      a <<= 1;
      if (a & 0x100) a ^= 0x11d;
    }
    return r;
  }

  /* 生成多项式，长度 degree+1，gen[0] 恒为 1 */
  function genPoly(degree) {
    var result = [1];
    var root = 1;
    for (var i = 0; i < degree; i++) {
      var next = [];
      for (var k = 0; k <= result.length; k++) next.push(0);
      for (var j = 0; j < result.length; j++) {
        next[j] ^= result[j];
        next[j + 1] ^= mul(result[j], root);
      }
      result = next;
      root = mul(root, 2);
    }
    return result;
  }

  /* 数据码字的多项式除法的余数 = 纠错码字 */
  function eccCodewords(data, degree) {
    var gen = genPoly(degree);
    var res = [];
    for (var i = 0; i < degree; i++) res.push(0);
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ res[0];
      res.shift();
      res.push(0);
      for (var j = 0; j < degree; j++) res[j] ^= mul(gen[j + 1], factor);
    }
    return res;
  }

  /* ---------- 版本表（M 级）：[纠错码字/块, 组1块数, 组1数据码字, 组2块数, 组2数据码字] ---------- */

  var BLOCKS_M = [
    null,
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51],
    [22, 6, 36, 2, 37],
    [22, 8, 37, 1, 38]
  ];

  var ALIGN = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62]
  ];

  /* ---------- 文本 → 字节 ---------- */

  function utf8Bytes(str) {
    var s = String(str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  /* ---------- 编码：挑版本 → 数据位 → 码字 → 纠错 → 交织 ---------- */

  function dataCapacity(version) {
    var t = BLOCKS_M[version];
    return t[1] * t[2] + t[3] * t[4];
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 13; v++) {
      var countBits = v < 10 ? 8 : 16;
      var need = 4 + countBits + byteLen * 8;
      if (need <= dataCapacity(v) * 8) return v;
    }
    return 0;
  }

  function buildCodewords(bytes, version) {
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }

    push(4, 4); // byte 模式
    push(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var totalDataBits = dataCapacity(version) * 8;
    /* 终止符最多 4 位 */
    for (var t = 0; t < 4 && bits.length < totalDataBits; t++) bits.push(0);
    /* 补齐到整字节 */
    while (bits.length % 8) bits.push(0);

    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      data.push(byte);
    }
    /* 填充码字 0xEC / 0x11 交替 */
    var pads = [0xec, 0x11];
    var p = 0;
    while (data.length < dataCapacity(version)) data.push(pads[p++ % 2]);

    /* 分块 + 纠错 */
    var table = BLOCKS_M[version];
    var ecLen = table[0];
    var blocks = [];
    var offset = 0;
    var b1 = table[1], d1 = table[2], b2 = table[3], d2 = table[4];
    for (var i1 = 0; i1 < b1; i1++) {
      var d = data.slice(offset, offset + d1);
      offset += d1;
      blocks.push({ data: d, ecc: eccCodewords(d, ecLen) });
    }
    for (var i2 = 0; i2 < b2; i2++) {
      var d2s = data.slice(offset, offset + d2);
      offset += d2;
      blocks.push({ data: d2s, ecc: eccCodewords(d2s, ecLen) });
    }

    /* 交织：先按列取数据码字，再按列取纠错码字 */
    var out = [];
    var maxData = Math.max.apply(null, blocks.map(function (b) { return b.data.length; }));
    for (var c = 0; c < maxData; c++) {
      for (var bi = 0; bi < blocks.length; bi++) {
        if (c < blocks[bi].data.length) out.push(blocks[bi].data[c]);
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var bj = 0; bj < blocks.length; bj++) out.push(blocks[bj].ecc[e]);
    }
    return out;
  }

  /* ---------- 矩阵绘制 ---------- */

  function makeMatrix(version, codewords) {
    var size = 17 + version * 4;
    var cells = [];
    var fixed = [];
    for (var i = 0; i < size * size; i++) { cells.push(0); fixed.push(false); }

    function set(x, y, dark) {
      cells[y * size + x] = dark ? 1 : 0;
      fixed[y * size + x] = true;
    }

    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, dist !== 2 && dist !== 4);
        }
      }
    }

    /* 三个定位图案 */
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    /* 定时图案 */
    for (var t = 8; t < size - 8; t++) {
      set(t, 6, t % 2 === 0);
      set(6, t, t % 2 === 0);
    }

    /* 校正图案 */
    var pos = ALIGN[version];
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        var isCorner = (a === 0 && b === 0) || (a === 0 && b === pos.length - 1) ||
          (a === pos.length - 1 && b === 0);
        if (isCorner) continue;
        var px = pos[b], py = pos[a];
        for (var dy2 = -2; dy2 <= 2; dy2++) {
          for (var dx2 = -2; dx2 <= 2; dx2++) {
            var d2 = Math.max(Math.abs(dx2), Math.abs(dy2));
            set(px + dx2, py + dy2, d2 !== 1);
          }
        }
      }
    }

    /* 格式信息区域先占位（稍后写真实值） */
    for (var f = 0; f <= 8; f++) {
      if (!fixed[8 * size + f]) set(f, 8, false);
      if (!fixed[f * size + 8]) set(8, f, false);
    }
    for (var g = 0; g < 8; g++) {
      if (!fixed[(size - 1 - g) * size + 8]) set(8, size - 1 - g, false);
      if (!fixed[8 * size + size - 1 - g]) set(size - 1 - g, 8, false);
    }
    set(8, size - 8, true); // 固定深色模块

    /* 版本信息（v7 以上）先占位，右上与左下各一块 */
    if (version >= 7) {
      for (var vv = 0; vv < 18; vv++) {
        var a1 = Math.floor(vv / 3), b1 = vv % 3;
        set(size - 11 + b1, a1, false);
        set(a1, size - 11 + b1, false);
      }
    }

    /* 数据位按之字形填入 */
    var bitIdx = 0;
    var upward = true;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        var y = upward ? size - 1 - vert : vert;
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          if (fixed[y * size + x]) continue;
          var bit = 0;
          if (bitIdx < codewords.length * 8) {
            bit = (codewords[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1;
          }
          bitIdx++;
          cells[y * size + x] = bit;
        }
      }
      upward = !upward;
    }

    return { size: size, cells: cells, fixed: fixed, set: set };
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
  ];

  function applyMask(m, mask) {
    var size = m.size;
    var cells = m.cells.slice();
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (!m.fixed[y * size + x] && mask(x, y)) cells[y * size + x] ^= 1;
      }
    }
    return cells;
  }

  /* 罚分：连续同色、2x2 同色、类似定位图案、黑白比例失衡 */
  function penalty(cells, size) {
    var score = 0;
    var x, y, run, prev;

    for (y = 0; y < size; y++) {
      run = 1;
      prev = cells[y * size];
      for (x = 1; x < size; x++) {
        var cur = cells[y * size + x];
        if (cur === prev) { run++; } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          prev = cur;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    for (x = 0; x < size; x++) {
      run = 1;
      prev = cells[x];
      for (y = 1; y < size; y++) {
        var cur2 = cells[y * size + x];
        if (cur2 === prev) { run++; } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          prev = cur2;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var v = cells[y * size + x];
        if (v === cells[y * size + x + 1] && v === cells[(y + 1) * size + x] &&
            v === cells[(y + 1) * size + x + 1]) score += 3;
      }
    }

    var pattern = [1, 0, 1, 1, 1, 0, 1];
    function matches(get, i) {
      for (var k = 0; k < 7; k++) if (get(i + k) !== pattern[k]) return false;
      var before = true, after = true;
      for (var b = 1; b <= 4; b++) if (i - b >= 0 && get(i - b) !== 0) before = false;
      for (var a = 1; a <= 4; a++) if (i + 6 + a < size && get(i + 6 + a) !== 0) after = false;
      return before || after;
    }

    for (y = 0; y < size; y++) {
      for (x = 0; x <= size - 7; x++) {
        if (matches(function (i) { return cells[y * size + i]; }, x)) score += 40;
      }
    }
    for (x = 0; x < size; x++) {
      for (y = 0; y <= size - 7; y++) {
        if (matches(function (i) { return cells[i * size + x]; }, y)) score += 40;
      }
    }

    var dark = 0;
    for (var i2 = 0; i2 < cells.length; i2++) dark += cells[i2];
    var ratio = Math.abs(dark * 100 / cells.length - 50);
    score += Math.floor(ratio / 5) * 10;
    return score;
  }

  function formatBits(mask) {
    var data = (0 << 3) | mask; // M 级 = 00
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (version << 12) | rem;
  }

  function writeFormat(cells, size, mask) {
    var bits = formatBits(mask);
    function bit(i) { return (bits >>> i) & 1; }
    var i;
    /* 左上副本：位 0-5 在竖条（第 8 列 0-5 行），位 9-14 在横条（第 8 行 5-0 列） */
    for (i = 0; i <= 5; i++) cells[i * size + 8] = bit(i);
    cells[7 * size + 8] = bit(6);
    cells[8 * size + 8] = bit(7);
    cells[8 * size + 7] = bit(8);
    for (i = 9; i < 15; i++) cells[8 * size + (14 - i)] = bit(i);
    /* 右上副本：位 0-7 在第 8 行右端；左下副本：位 8-14 在第 8 列底端 */
    for (i = 0; i < 8; i++) cells[8 * size + (size - 1 - i)] = bit(i);
    for (i = 8; i < 15; i++) cells[(size - 15 + i) * size + 8] = bit(i);
    cells[(size - 8) * size + 8] = 1;
  }

  function writeVersion(cells, size, version) {
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var bit = (bits >>> i) & 1;
      var a = Math.floor(i / 3), b = i % 3;
      cells[(size - 11 + b) * size + a] = bit;
      cells[a * size + (size - 11 + b)] = bit;
    }
  }

  /* ---------- 对外接口 ---------- */

  function matrix(text) {
    var bytes = utf8Bytes(text);
    var version = pickVersion(bytes.length);
    if (!version) return null;
    var codewords = buildCodewords(bytes, version);
    var m = makeMatrix(version, codewords);

    var best = null;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var cells = applyMask(m, MASKS[mask]);
      writeFormat(cells, m.size, mask);
      if (version >= 7) writeVersion(cells, m.size, version);
      var score = penalty(cells, m.size);
      if (score < bestScore) { bestScore = score; best = cells; }
    }
    return { size: m.size, cells: best, version: version };
  }

  function svg(text, opts) {
    var qr = matrix(text);
    if (!qr) return '';
    var margin = opts && opts.margin !== undefined ? opts.margin : 3;
    var dim = qr.size + margin * 2;
    var path = '';
    for (var y = 0; y < qr.size; y++) {
      var start = -1;
      for (var x = 0; x <= qr.size; x++) {
        var dark = x < qr.size && qr.cells[y * qr.size + x] === 1;
        if (dark && start < 0) {
          start = x;
        } else if (!dark && start >= 0) {
          path += 'M' + (start + margin) + ' ' + (y + margin) + 'h' + (x - start) + 'v1h-' + (x - start) + 'z';
          start = -1;
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="页面二维码">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<path d="' + path + '" fill="#111111"/></svg>';
  }

  global.MDQr = { matrix: matrix, svg: svg };
})(window);
