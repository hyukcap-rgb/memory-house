/* 기억의 집 · 1004 별 천사
   배경에 은은한 천사를 그리고, 그 위를 1004개의 다각형 조각으로 덮는다.
   채워진 자리는 아이들 사진, 빈 자리는 빛의 윤곽만 남는다.
   자리 번호는 후광(빛)에서 가까운 순서로 1~1004. */
(function () {
  const TOTAL = 1004;
  const BW = 360, BH = 440; // base logical size
  const LIGHT = { x: 0.5 * BW, y: 0.17 * BW };

  // ---------- shape (unit = BW) ----------
  function haloPath(c, k) {
    c.beginPath();
    c.ellipse(0.5 * k, 0.1 * k, 0.088 * k, 0.026 * k, 0, 0, Math.PI * 2);
    c.ellipse(0.5 * k, 0.1 * k, 0.06 * k, 0.013 * k, 0, 0, Math.PI * 2);
  }
  function headPath(c, k) {
    c.beginPath();
    c.arc(0.5 * k, 0.18 * k, 0.047 * k, 0, Math.PI * 2);
    c.rect(0.478 * k, 0.215 * k, 0.044 * k, 0.05 * k);
  }
  function wingPath(c, k, mirror) {
    const X = (x) => (mirror ? 1 - x : x) * k, Y = (y) => y * k;
    c.beginPath();
    c.moveTo(X(0.47), Y(0.36));
    // leading edge sweeps up and out
    c.bezierCurveTo(X(0.4), Y(0.2), X(0.24), Y(0.08), X(0.05), Y(0.03));
    // feather scallops along the trailing edge
    const pts = [[0.05, 0.12], [0.07, 0.21], [0.1, 0.3], [0.14, 0.39], [0.19, 0.47], [0.25, 0.54], [0.31, 0.59], [0.37, 0.6], [0.42, 0.55]];
    let px = 0.05, py = 0.03;
    for (const [x, y] of pts) {
      const mx = (px + x) / 2, my = (py + y) / 2;
      const nx = -(y - py), ny = x - px; // points away from the wing body
      const n = Math.hypot(nx, ny) || 1;
      c.quadraticCurveTo(X(mx + (nx / n) * 0.028), Y(my + (ny / n) * 0.028), X(x), Y(y));
      px = x; py = y;
    }
    c.quadraticCurveTo(X(0.46), Y(0.5), X(0.47), Y(0.36));
    c.closePath();
  }
  function robePath(c, k) {
    const P = (x, y) => [x * k, y * k];
    c.beginPath();
    c.moveTo(...P(0.455, 0.255));
    c.quadraticCurveTo(...P(0.4, 0.27), ...P(0.395, 0.33));
    c.bezierCurveTo(...P(0.4, 0.45), ...P(0.42, 0.5), ...P(0.41, 0.58));
    c.bezierCurveTo(...P(0.39, 0.78), ...P(0.33, 0.95), ...P(0.29, 1.1));
    // flowing hem, no feet: the cloth trails to the right
    c.quadraticCurveTo(...P(0.33, 1.15), ...P(0.38, 1.12));
    c.quadraticCurveTo(...P(0.44, 1.17), ...P(0.5, 1.13));
    c.quadraticCurveTo(...P(0.57, 1.19), ...P(0.63, 1.14));
    c.quadraticCurveTo(...P(0.71, 1.2), ...P(0.79, 1.15));
    c.quadraticCurveTo(...P(0.86, 1.17), ...P(0.9, 1.1));
    c.quadraticCurveTo(...P(0.8, 1.09), ...P(0.74, 1.02));
    c.bezierCurveTo(...P(0.66, 0.88), ...P(0.6, 0.72), ...P(0.59, 0.58));
    c.bezierCurveTo(...P(0.58, 0.5), ...P(0.6, 0.45), ...P(0.605, 0.33));
    c.quadraticCurveTo(...P(0.6, 0.27), ...P(0.545, 0.255));
    c.closePath();
  }
  function wispPath(c, k) {
    c.beginPath();
    c.moveTo(0.86 * k, 1.07 * k);
    c.quadraticCurveTo(0.93 * k, 1.0 * k, 0.96 * k, 0.91 * k);
    c.quadraticCurveTo(0.97 * k, 1.02 * k, 0.9 * k, 1.11 * k);
    c.closePath();
    c.moveTo(0.27 * k, 1.04 * k);
    c.quadraticCurveTo(0.2 * k, 1.0 * k, 0.17 * k, 0.93 * k);
    c.quadraticCurveTo(0.2 * k, 1.04 * k, 0.29 * k, 1.09 * k);
    c.closePath();
  }
  function fillAll(c, k, style) {
    c.fillStyle = style;
    headPath(c, k); c.fill();
    wingPath(c, k, false); c.fill();
    wingPath(c, k, true); c.fill();
    robePath(c, k); c.fill();
  }

  // ---------- tessellation ----------
  function hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
  let GEO = null;
  function geometry() {
    if (GEO) return GEO;
    const S = 2; // mask oversample
    const mc = document.createElement("canvas");
    mc.width = BW * S; mc.height = BH * S;
    const m = mc.getContext("2d", { willReadFrequently: true });
    fillAll(m, BW * S, "#000");
    const data = m.getImageData(0, 0, mc.width, mc.height).data;
    const inside = (x, y) => {
      const ix = Math.round(x * S), iy = Math.round(y * S);
      if (ix < 0 || iy < 0 || ix >= mc.width || iy >= mc.height) return 0;
      return data[(iy * mc.width + ix) * 4 + 3] > 127 ? 1 : 0;
    };
    const cover = (t) => {
      const [a, b, c] = t;
      const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const s = [g, [(a[0] + g[0]) / 2, (a[1] + g[1]) / 2], [(b[0] + g[0]) / 2, (b[1] + g[1]) / 2], [(c[0] + g[0]) / 2, (c[1] + g[1]) / 2]];
      return s.reduce((n, p) => n + inside(p[0], p[1]), 0) / 4;
    };
    const lattice = (s) => {
      const h = (s * Math.sqrt(3)) / 2;
      const rows = Math.ceil(BH / h) + 2, cols = Math.ceil(BW / s) + 2;
      const pt = [];
      for (let r = 0; r < rows; r++) {
        pt[r] = [];
        for (let q = 0; q < cols; q++) {
          const id = r * 1000 + q;
          const jx = (hash(id * 2 + 1) - 0.5) * 0.36 * s, jy = (hash(id * 2 + 2) - 0.5) * 0.36 * s;
          pt[r][q] = [q * s + (r % 2 ? s / 2 : 0) - s / 2 + jx, r * h - h / 2 + jy];
        }
      }
      const tris = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let q = 0; q < cols - 1; q++) {
          if (r % 2 === 0) {
            tris.push([pt[r][q], pt[r][q + 1], pt[r + 1][q]]);
            tris.push([pt[r][q + 1], pt[r + 1][q + 1], pt[r + 1][q]]);
          } else {
            tris.push([pt[r][q], pt[r][q + 1], pt[r + 1][q + 1]]);
            tris.push([pt[r][q], pt[r + 1][q + 1], pt[r + 1][q]]);
          }
        }
      }
      return tris.map((t) => ({ p: t, cov: cover(t) })).filter((t) => t.cov >= 0.5);
    };
    // find a size giving at least TOTAL tiles
    let lo = 3, hi = 20, best = null;
    for (let i = 0; i < 18; i++) {
      const s = (lo + hi) / 2;
      const t = lattice(s);
      if (t.length >= TOTAL) { best = t; lo = s; } else hi = s;
    }
    best.sort((a, b) => b.cov - a.cov);
    let tiles = best.slice(0, TOTAL).map((t) => {
      const [a, b, c] = t.p;
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      return {
        p: t.p, cx, cy,
        minx: Math.min(a[0], b[0], c[0]), maxx: Math.max(a[0], b[0], c[0]),
        miny: Math.min(a[1], b[1], c[1]), maxy: Math.max(a[1], b[1], c[1]),
        d: Math.hypot(cx - LIGHT.x, (cy - LIGHT.y) * 0.9),
      };
    });
    tiles.sort((a, b) => a.d - b.d);
    tiles.forEach((t, i) => {
      t.seat = i + 1;
      t.zone = i < 104 ? "halo" : Math.abs(t.cx - BW / 2) > 0.105 * BW && t.cy < 0.62 * BW ? "wing" : "robe";
      t.photo = Math.floor(hash(t.seat * 7 + 3) * 1e6);
      t.shade = 0.82 + hash(t.seat * 13 + 5) * 0.3;
    });
    GEO = { tiles, bySeat: [null, ...tiles] };
    return GEO;
  }

  const ZONES = { halo: "후광 곁", wing: "날개", robe: "옷자락" };

  // ---------- photos ----------
  const photoCache = {};
  function loadPhotos(urls) {
    return Promise.all(urls.map((u) => photoCache[u] || (photoCache[u] = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = u;
    })))).then((a) => a.filter(Boolean));
  }

  // ---------- renderer ----------
  function mount(canvas, opts) {
    opts = opts || {};
    const geo = geometry();
    let taken = new Set(opts.taken || []);
    let mine = new Set(opts.mine || []);
    let picked = new Set(opts.picked || []);
    let shown = opts.animate ? 0 : TOTAL; // tiles revealed so far
    let photos = [];
    let raf = 0, dead = false, t0 = 0;
    const base = document.createElement("canvas");
    let scale = 1, dpr = 1;

    function size() {
      const w = canvas.clientWidth || BW;
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      scale = w / BW;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * (BH / BW) * dpr);
      base.width = canvas.width; base.height = canvas.height;
    }

    function tri(c, t) { c.beginPath(); c.moveTo(t.p[0][0], t.p[0][1]); c.lineTo(t.p[1][0], t.p[1][1]); c.lineTo(t.p[2][0], t.p[2][1]); c.closePath(); }

    function drawBackground(c) {
      // night sky + rays from the halo
      const g = c.createRadialGradient(LIGHT.x, LIGHT.y - 30, 10, LIGHT.x, LIGHT.y + 120, BH * 0.9);
      g.addColorStop(0, "rgba(255,236,190,.22)");
      g.addColorStop(0.35, "rgba(120,110,160,.08)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, BW, BH);
      c.save();
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI / 2 + (i - 6.5) * 0.2;
        c.beginPath();
        c.moveTo(LIGHT.x, LIGHT.y - 40);
        c.lineTo(LIGHT.x + Math.cos(a - 0.04) * 420, LIGHT.y - 40 + Math.sin(a - 0.04) * 420);
        c.lineTo(LIGHT.x + Math.cos(a + 0.04) * 420, LIGHT.y - 40 + Math.sin(a + 0.04) * 420);
        c.closePath();
        c.fillStyle = `rgba(255,230,180,${0.018 + 0.012 * (i % 3)})`;
        c.fill();
      }
      c.restore();
      // soft angel underneath
      c.save();
      c.filter = "blur(10px)";
      fillAll(c, BW, "rgba(255,228,170,.22)");
      c.restore();
      const body = c.createLinearGradient(0, 0, 0, BH);
      body.addColorStop(0, "rgba(255,240,205,.20)");
      body.addColorStop(0.6, "rgba(231,199,123,.11)");
      body.addColorStop(1, "rgba(231,199,123,.05)");
      fillAll(c, BW, body);
      // halo of pure light
      c.save();
      c.globalCompositeOperation = "lighter";
      c.shadowColor = "rgba(255,226,150,1)"; c.shadowBlur = 18;
      c.strokeStyle = "rgba(255,232,170,.95)"; c.lineWidth = 3.2;
      c.beginPath(); c.ellipse(0.5 * BW, 0.1 * BW, 0.074 * BW, 0.02 * BW, 0, 0, Math.PI * 2); c.stroke();
      c.shadowBlur = 0; c.strokeStyle = "rgba(255,250,230,.9)"; c.lineWidth = 1.1; c.stroke();
      c.restore();
    }

    function drawTile(c, t) {
      if (taken.has(t.seat) || mine.has(t.seat)) {
        const im = photos.length ? photos[t.photo % photos.length] : null;
        c.save();
        tri(c, t);
        c.clip();
        if (im) {
          const s = Math.min(im.width, im.height) * (0.55 + (t.photo % 5) * 0.08);
          const sx = (im.width - s) * ((t.photo >> 3) % 7) / 6, sy = (im.height - s) * ((t.photo >> 6) % 5) / 4;
          const bw = t.maxx - t.minx, bh = t.maxy - t.miny, d = Math.max(bw, bh) + 1;
          c.globalAlpha = 0.95;
          c.drawImage(im, sx, sy, s, s, t.cx - d / 2, t.cy - d / 2, d, d);
          c.globalAlpha = 1;
        } else {
          c.fillStyle = "#d9c9a4"; c.fill();
        }
        // warm light falls off away from the halo
        const k = 0.16 + Math.max(0, 1 - t.d / 380) * 0.3 * t.shade;
        c.fillStyle = `rgba(255,226,170,${k})`;
        c.fill();
        c.restore();
        tri(c, t);
        c.strokeStyle = "rgba(255,244,220,.32)";
        c.lineWidth = 0.45;
        c.stroke();
      } else {
        tri(c, t);
        c.fillStyle = "rgba(255,236,190,.035)";
        c.fill();
        c.strokeStyle = "rgba(231,199,123,.42)";
        c.lineWidth = 0.5;
        c.stroke();
      }
    }

    function renderBase() {
      const c = base.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, base.width, base.height);
      c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      drawBackground(c);
      for (let i = 0; i < shown; i++) drawTile(c, geo.tiles[i]);
    }

    function frame(now) {
      if (dead) return;
      const c = canvas.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.drawImage(base, 0, 0);
      c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      const pulse = 0.5 + 0.5 * Math.sin(now / 420);
      const glow = (seat, color, w) => {
        const t = geo.bySeat[seat];
        if (!t || t.seat > shown) return;
        c.save();
        c.shadowColor = color; c.shadowBlur = 10 + 8 * pulse;
        tri(c, t);
        c.strokeStyle = color; c.lineWidth = w;
        c.stroke();
        c.restore();
      };
      mine.forEach((s) => glow(s, "rgba(255,222,140,1)", 1.6));
      picked.forEach((s) => {
        const t = geo.bySeat[s];
        if (!t) return;
        c.save();
        tri(c, t);
        c.fillStyle = `rgba(255,236,190,${0.55 + 0.35 * pulse})`;
        c.fill();
        c.restore();
        glow(s, "rgba(255,255,255,1)", 1.4);
        // locator ring
        c.beginPath();
        c.arc(t.cx, t.cy, 9 + 4 * pulse, 0, Math.PI * 2);
        c.strokeStyle = `rgba(255,255,255,${0.75 - 0.4 * pulse})`;
        c.lineWidth = 1;
        c.stroke();
      });
      raf = requestAnimationFrame(frame);
    }

    function animateIn(ms) {
      ms = ms || 2600;
      const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) { shown = TOTAL; renderBase(); return Promise.resolve(); }
      shown = 0; renderBase();
      return new Promise((res) => {
        t0 = performance.now();
        const c = base.getContext("2d");
        const step = (now) => {
          if (dead) return res();
          const p = Math.max(0, Math.min(1, (now - t0) / ms));
          const target = Math.max(shown, Math.min(TOTAL, Math.floor(TOTAL * (1 - Math.pow(1 - p, 2.2)))));
          c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
          for (let i = shown; i < target; i++) drawTile(c, geo.tiles[i]);
          shown = target;
          if (p < 1) requestAnimationFrame(step); else { shown = TOTAL; renderBase(); res(); }
        };
        requestAnimationFrame(step);
      });
    }

    function seatAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * BW, y = ((clientY - r.top) / r.height) * BH;
      const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
      let best = null, bd = 1e9;
      for (const t of geo.tiles) {
        if (x < t.minx - 8 || x > t.maxx + 8 || y < t.miny - 8 || y > t.maxy + 8) continue;
        const [a, b, c] = t.p, P = [x, y];
        const d1 = sign(P, a, b), d2 = sign(P, b, c), d3 = sign(P, c, a);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return t.seat;
        const d = Math.hypot(t.cx - x, t.cy - y);
        if (d < bd) { bd = d; best = t.seat; }
      }
      return bd < 7 ? best : null;
    }

    function onClick(e) {
      if (!opts.onTap) return;
      const s = seatAt(e.clientX, e.clientY);
      if (s) opts.onTap(s, { taken: taken.has(s) || mine.has(s), mine: mine.has(s), zone: geo.bySeat[s].zone });
    }
    canvas.addEventListener("click", onClick);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { size(); renderBase(); }) : null;
    size();
    renderBase();
    ro && ro.observe(canvas);
    raf = requestAnimationFrame(frame);
    loadPhotos(opts.photos || []).then((p) => { photos = p; if (!dead) renderBase(); });

    return {
      animateIn,
      setTaken(arr) { taken = new Set(arr); renderBase(); },
      setMine(arr) { mine = new Set(arr); renderBase(); },
      setPicked(arr) { picked = new Set(arr); },
      tileOf: (seat) => geo.bySeat[seat],
      pointOf(seat) { const t = geo.bySeat[seat]; return t && { x: t.cx / BW, y: t.cy / BH }; },
      destroy() { dead = true; cancelAnimationFrame(raf); ro && ro.disconnect(); canvas.removeEventListener("click", onClick); },
    };
  }

  function zoneStats(takenArr) {
    const geo = geometry();
    const taken = new Set(takenArr);
    const out = { halo: { total: 0, left: 0 }, wing: { total: 0, left: 0 }, robe: { total: 0, left: 0 } };
    for (const t of geo.tiles) { out[t.zone].total++; if (!taken.has(t.seat)) out[t.zone].left++; }
    return out;
  }
  function freeSeats(takenArr, zone) {
    const taken = new Set(takenArr);
    return geometry().tiles.filter((t) => !taken.has(t.seat) && (!zone || t.zone === zone)).map((t) => t.seat);
  }
  function zoneOf(seat) { const t = geometry().bySeat[seat]; return t && t.zone; }

  window.Angel = { TOTAL, ZONES, mount, zoneStats, freeSeats, zoneOf, ratio: BH / BW };
})();
