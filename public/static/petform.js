/* 기억의 집 · 아이 정보 입력 부품
   비회원 예약 직후(아이 소개)와 회원 화면(정보 고치기)에서 같이 쓴다. */
(function () {
  const css = `
.pf{color:#1D2130}
.pf .pf-photo{display:flex;align-items:center;gap:16px;margin:4px 0 6px}
.pf .pf-pic{width:96px;height:96px;border-radius:50%;background:#EDEBE6 center/cover no-repeat;display:grid;place-items:center;flex:none;overflow:hidden;color:#8A8F9C;border:1px solid #E6E3DD}
.pf .pf-pic svg{width:30px;height:30px}
.pf .pf-pick,.pf .pf-pick:focus-within{outline:2px solid #2E4374;outline-offset:2px}
.pf .pf-pick input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.pf label.pf-l,.pf span.pf-l{display:block;font-size:13px;font-weight:700;margin:16px 0 6px}
.pf .pf-hint{font-weight:400;color:#6B7080;font-size:12px;margin-left:4px}
.pf .pf-in{width:100%;height:50px;border:1px solid #E6E3DD;border-radius:14px;padding:0 14px;font:inherit;font-size:16px;background:#fff;color:#1D2130}
.pf .pf-in:focus{outline:2px solid #2E4374;border-color:transparent}
.pf .pf-in[aria-invalid="true"]{border-color:#B2453A}
.pf .pf-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pf .pf-two > div{min-width:0}
.pf .pf-unit{position:relative}
.pf .pf-unit span{position:absolute;right:14px;top:50%;transform:translateY(-50%);color:#6B7080;font-size:15px;pointer-events:none}
.pf .pf-unit .pf-in{padding-right:40px}
.pf .pf-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.pf .pf-tag{display:inline-flex;align-items:center;gap:4px;height:36px;padding:0 6px 0 12px;border-radius:999px;background:#F7F1E3;color:#7A5B1E;font-size:13px;font-weight:700}
.pf .pf-tag button{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:#7A5B1E;background:none;border:0;cursor:pointer;font-size:16px}
.pf .pf-tagrow{display:flex;gap:8px}
.pf .pf-tagrow .pf-in{flex:1}
.pf .pf-add{height:50px;padding:0 16px;border-radius:14px;background:#EDEBE6;font-weight:700;border:0;cursor:pointer;color:#1D2130;white-space:nowrap}
.pf .pf-err{color:#B2453A;font-size:13px;margin-top:6px}
`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  let tags = [];
  let photoData = null; // 새로 고른 사진 (dataURL)

  function html(p, passedAway) {
    tags = (p.tags || []).slice(0, 3);
    photoData = null;
    const pic = p.photo ? `style="background-image:url('${esc(p.photo)}')"` : "";
    return `<div class="pf" id="pf">
  <div class="pf-photo">
    <span class="pf-pic" id="pf-pic" ${pic} aria-hidden="true">${p.photo ? "" : CAMERA}</span>
    <div><label class="pf-pick" data-testid="pf-photo-btn">${p.photo ? "다른 사진으로 바꾸기" : "가장 예쁜 사진 고르기"}<input type="file" accept="image/*" id="pf-file" data-testid="pf-file"></label>
    <div class="pf-hint" style="margin:6px 0 0">아이를 만나러 오면 가장 먼저 보여요</div><div class="pf-err" id="pf-e-photo" role="alert"></div></div>
  </div>
  <label class="pf-l" for="pf-nickname">우리끼리 ${passedAway ? "부르던" : "부르는"} 이름</label><input class="pf-in" id="pf-nickname" maxlength="20" value="${esc(p.nickname)}" placeholder="예: 우리 강아지, 꼬맹이" data-testid="pf-nickname">
  <div class="pf-two">
    <div><label class="pf-l" for="pf-birth">태어난 날</label><input class="pf-in" type="date" id="pf-birth" max="${today()}" value="${esc(p.birth)}" data-testid="pf-birth"></div>
    ${passedAway ? `<div><label class="pf-l" for="pf-passed">천사를 만난 날</label><input class="pf-in" type="date" id="pf-passed" max="${today()}" value="${esc(p.passed)}" data-testid="pf-passed"></div>` : `<div><label class="pf-l" for="pf-weight">품에 안긴 무게</label><div class="pf-unit"><input class="pf-in" id="pf-weight" inputmode="decimal" maxlength="6" value="${esc(p.weight)}" placeholder="3.2" data-testid="pf-weight"><span>kg</span></div></div>`}
  </div>
  ${passedAway ? `<label class="pf-l" for="pf-weight">품에 안긴 무게</label><div class="pf-unit"><input class="pf-in" id="pf-weight" inputmode="decimal" maxlength="6" value="${esc(p.weight)}" placeholder="3.2" data-testid="pf-weight"><span>kg</span></div>` : ""}
  <div class="pf-err" id="pf-e-date" role="alert"></div>
  <label class="pf-l" for="pf-likes">${passedAway ? "좋아하던 것" : "좋아하는 것"}</label>
  <input class="pf-in" id="pf-likes" maxlength="60" value="${esc(p.likes)}" placeholder="예: 산책, 창가 낮잠" data-testid="pf-likes">
  <label class="pf-l" for="pf-tagin">${passedAway ? "이런 아이였어요" : "이런 아이예요"} <span class="pf-hint">3개까지</span></label>
  <div class="pf-tagrow"><input class="pf-in" id="pf-tagin" maxlength="16" placeholder="예: 겁 많고 다정함" data-testid="pf-tagin"><button type="button" class="pf-add" id="pf-addtag" data-testid="pf-addtag">추가</button></div>
  <div class="pf-tags" id="pf-tags" aria-live="polite"></div>
  ${passedAway ? `<label style="display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-size:14px;line-height:1.5;cursor:pointer"><input type="checkbox" id="pf-plaza" data-testid="pf-plaza" ${p.showInPlaza===false?'':'checked'} style="width:20px;height:20px;margin-top:1px;flex:none;accent-color:#2E4374"><span>별빛 광장에 보이기<br><span class="pf-hint" style="margin:0">다른 보호자들이 이름과 대표 사진을 보고 위로의 꽃을 놓을 수 있어요</span></span></label>` : ""}
</div>`;
  }

  function drawTags() {
    const box = document.getElementById("pf-tags");
    if (!box) return;
    box.innerHTML = tags.map((t, i) => `<span class="pf-tag">${esc(t)}<button type="button" aria-label="${esc(t)} 빼기" data-i="${i}">×</button></span>`).join("");
    box.querySelectorAll("button").forEach((b) => (b.onclick = () => { tags.splice(Number(b.dataset.i), 1); drawTags(); }));
    const add = document.getElementById("pf-addtag");
    if (add) add.disabled = tags.length >= 3;
  }

  function resize(file, max = 1280) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement("canvas");
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", 0.86));
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("사진을 읽지 못했어요. 다른 사진을 골라 주세요")); };
      im.src = url;
    });
  }

  function bind() {
    drawTags();
    const addTag = () => {
      const inp = document.getElementById("pf-tagin");
      const v = inp.value.trim();
      if (!v) return;
      if (tags.length >= 3) return;
      if (!tags.includes(v)) tags.push(v);
      inp.value = "";
      drawTags();
      inp.focus();
    };
    document.getElementById("pf-addtag").onclick = addTag;
    document.getElementById("pf-tagin").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } };
    document.getElementById("pf-file").onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      const err = document.getElementById("pf-e-photo");
      err.textContent = "";
      if (!f) return;
      if (!f.type.startsWith("image/")) { err.textContent = "사진 파일을 골라 주세요"; return; }
      try {
        photoData = await resize(f);
        const pic = document.getElementById("pf-pic");
        pic.style.backgroundImage = `url('${photoData}')`;
        pic.innerHTML = "";
      } catch (x) { err.textContent = x.message; }
    };
    ["pf-birth", "pf-passed", "pf-weight"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => { el.setAttribute("aria-invalid", "false"); document.getElementById("pf-e-date").textContent = ""; });
    });
  }

  function read() {
    const v = (id) => (document.getElementById(id)?.value || "").trim();
    const pending = v("pf-tagin");
    const t = tags.slice();
    if (pending && t.length < 3 && !t.includes(pending)) t.push(pending);
    const plaza = document.getElementById("pf-plaza");
    const out = { ...(plaza ? { showInPlaza: plaza.checked } : {}), nickname: v("pf-nickname"), birth: v("pf-birth"), weight: v("pf-weight").replace(/kg$/i, "").trim(), likes: v("pf-likes"), tags: t };
    if (document.getElementById("pf-passed")) out.passed = v("pf-passed");
    return out;
  }

  function validate(d) {
    const err = document.getElementById("pf-e-date");
    const bad = (id, msg) => { document.getElementById(id)?.setAttribute("aria-invalid", "true"); err.textContent = msg; document.getElementById(id)?.focus(); return false; };
    if (d.birth && d.birth > today()) return bad("pf-birth", "생일은 오늘보다 앞이어야 해요");
    if (d.passed && d.passed > today()) return bad("pf-passed", "천사를 만난 날은 오늘보다 앞이어야 해요");
    if (d.birth && d.passed && d.passed < d.birth) return bad("pf-passed", "천사를 만난 날이 태어난 날보다 앞설 수 없어요");
    if (d.weight && !/^\d{1,3}(\.\d{1,2})?$/.test(d.weight)) return bad("pf-weight", "무게는 숫자로 적어 주세요 (예: 3.2)");
    return true;
  }

  // 서버에 저장: 사진이 있으면 사진 먼저, 그다음 정보
  async function save(petId, d) {
    const call = async (path, data) => {
      const r = await fetch(path, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "잠시 후 다시 시도해 주세요");
      return j.pet;
    };
    if (photoData) await call(`/api/me/pets/${petId}/photo`, { image: photoData });
    return call(`/api/me/pets/${petId}`, d);
  }

  window.PetForm = { html, bind, read, validate, save, resize };

})();
