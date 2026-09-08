(function () {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function svgWrap(inner, w, h, cls) {
    return (
      '<svg class="viz ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img">' +
      inner + '</svg>'
    );
  }

  window.Charts = {
    circleLength: function (r) {
      return 2 * Math.PI * r;
    },

    ring: function (pct, r, stroke) {
      var length = 2 * Math.PI * r;
      var offset = length * (1 - Math.max(0, Math.min(100, pct)) / 100);
      return (
        '<circle class="ring-bg" cx="60" cy="60" r="' + r + '"></circle>' +
        '<circle class="ring-fg" cx="60" cy="60" r="' + r + '" style="stroke-dasharray:' + length +
        ';stroke-dashoffset:' + offset + ';' + (stroke ? 'stroke:' + stroke + ';' : '') + '"></circle>'
      );
    },

    line: function (points) {
      if (!points || !points.length) return '';
      var w = Math.max(340, points.length * 90);
      var h = 120;
      var padL = 28;
      var padR = 14;
      var padT = 16;
      var padB = 26;
      var maxVal = 1;
      points.forEach(function (p) {
        var v = Number(p.value) || 0;
        if (v > maxVal) maxVal = v;
      });
      var innerW = w - padL - padR;
      var innerH = h - padT - padB;
      var coords = points.map(function (p, i) {
        var x = points.length === 1
          ? padL + innerW / 2
          : padL + (innerW * i) / (points.length - 1);
        var y = padT + innerH - (Math.max(0, Number(p.value) || 0) / maxVal) * innerH;
        return { x: x, y: y, p: p };
      });
      var path = coords.map(function (c) { return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');
      var circles = coords.map(function (c) {
        return (
          '<circle class="line-dot dot-' + (c.p.ks || 'intermediate') + '" cx="' + c.x.toFixed(1) +
          '" cy="' + c.y.toFixed(1) + '" r="5"></circle>' +
          '<text class="line-label" x="' + c.x.toFixed(1) + '" y="' + (h - 6) + '" text-anchor="middle">Q' +
          c.p.k + '</text>'
        );
      }).join('');
      return svgWrap(
        '<polyline class="line-path" points="' + path + '"></polyline>' + circles,
        w, h, 'viz-line'
      );
    },

    bars: function (items) {
      if (!items || !items.length) return '';
      var gap = 8;
      var bw = 22;
      var h = 120;
      var padT = 14;
      var padB = 26;
      var w = items.length * (bw + gap) + 26;
      var maxVal = 1;
      items.forEach(function (it) {
        if ((Number(it.value) || 0) > maxVal) maxVal = Number(it.value);
      });
      var innerH = h - padT - padB;
      var bars = items.map(function (it, i) {
        var bh = (Math.max(0, Number(it.value) || 0) / maxVal) * innerH;
        var x = 13 + i * (bw + gap);
        var y = padT + innerH - bh;
        return (
          '<rect class="bar" x="' + x + '" y="' + y.toFixed(1) + '" width="' + bw + '" height="' + bh.toFixed(1) +
          '" rx="3"></rect>' +
          '<text class="line-label" x="' + (x + bw / 2) + '" y="' + (h - 6) + '" text-anchor="middle">' +
          esc(it.k) + '</text>'
        );
      }).join('');
      return svgWrap(bars, w, h, 'viz-bars');
    },
  };
})();