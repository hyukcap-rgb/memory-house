// 기억의 집 서버: 화면(public/)과 API를 함께 제공한다.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join, normalize } from "node:path";
import {
  BASE, HALLS, TOTAL, seedState,
  type Account, type FeedItem, type Guest, type Hall, type Pet, type Reservation, type State, type Transfer,
} from "./seed";
import { createStorage } from "./storage";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const STATE_KEY = "data/state.json";
const SESSION_COOKIE = "mh_s";
const SESSION_DAYS = 30;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const storage = createStorage();

// ---------- state ----------
let state: State | null = null;
async function load(): Promise<State> {
  if (state) return state;
  try {
    const raw = await storage.read(STATE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) {
    console.error("데이터 읽기 실패", String(e));
  }
  if (!state) {
    state = seedState();
    await save();
  }
  // 예전 형식 데이터 보강
  state.accounts ??= [];
  state.pets ??= [];
  state.feed ??= [];
  state.sessions ??= {};
  return state!;
}
let saving: Promise<void> = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state);
  saving = saving.then(() => storage.write(STATE_KEY, snapshot)).catch((e) => console.error("데이터 저장 실패", String(e)));
  return saving;
}
const nextId = (p: string) => `${p}-${String(++state!.seq).padStart(4, "0")}`;

function takenFor(hallId: string): Set<number> {
  const set = new Set(BASE[hallId]);
  for (const r of state!.reservations) {
    if (r.hall === hallId && r.source !== "seed" && r.status === "active") r.seats.forEach((n) => set.add(n));
  }
  return set;
}
const hallSummary = (h: Hall) => {
  const taken = takenFor(h.id).size;
  return { id: h.id, name: h.name, desc: h.desc, total: TOTAL, taken, left: TOTAL - taken };
};

// ---------- helpers ----------
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);
async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}
const clean = (v: unknown, max = 60) => String(v ?? "").trim().slice(0, max);
const digits = (v: unknown) => clean(v, 20).replace(/\D/g, "");
const isPhone = (d: string) => /^01\d{8,9}$/.test(d);
const isDate = (v: string) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));

function isAdmin(req: Request) {
  const want = Bun.env.ADMIN_CODE;
  const got = req.headers.get("x-admin-code") || "";
  if (!want) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 쓰기 요청 남용 막기: IP당 1분에 40회 (로그인은 10회)
const hits = new Map<string, { n: number; t: number }>();
function limited(key: string, max: number) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > 60_000) { hits.set(key, { n: 1, t: now }); return false; }
  h.n++;
  if (hits.size > 5000) hits.clear();
  return h.n > max;
}
const ipOf = (req: Request, srv: { requestIP(r: Request): { address: string } | null }) =>
  req.headers.get("x-forwarded-for")?.split(",")[0].trim() || srv.requestIP(req)?.address || "?";

// ---------- sessions ----------
function cookieOf(req: Request, name: string) {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}
function sessionCookie(req: Request, token: string, maxAge: number) {
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function startSession(req: Request, accountId: string) {
  const token = randomBytes(32).toString("hex");
  state!.sessions[token] = { accountId, exp: Date.now() + SESSION_DAYS * 864e5 };
  for (const [t, s] of Object.entries(state!.sessions)) if (s.exp < Date.now()) delete state!.sessions[t];
  return sessionCookie(req, token, SESSION_DAYS * 86400);
}
function accountOf(req: Request): Account | null {
  const token = cookieOf(req, SESSION_COOKIE);
  const s = token && state!.sessions[token];
  if (!s || s.exp < Date.now()) return null;
  return state!.accounts.find((a) => a.id === s.accountId) || null;
}

// ---------- pets ----------
const PET_FIELDS = { nickname: 20, birth: 10, passed: 10, weight: 10, likes: 60, breed: 30, kind: 20, petStatus: 20, name: 20 } as const;
function applyPetFields(p: Pet, b: any): string | null {
  for (const [k, max] of Object.entries(PET_FIELDS)) {
    if (b[k] === undefined) continue;
    const v = clean(b[k], max);
    if ((k === "birth" || k === "passed") && !isDate(v)) return "날짜를 다시 확인해 주세요";
    if (k === "name" && !v) return "아이 이름을 적어 주세요";
    (p as any)[k] = v;
  }
  if (p.birth && p.passed && p.passed < p.birth) return "떠난 날이 생일보다 앞설 수 없어요";
  if (b.weight !== undefined && p.weight && !/^\d{1,3}(\.\d{1,2})?$/.test(p.weight)) return "몸무게는 숫자로 적어 주세요 (예: 3.2)";
  if (typeof b.showInPlaza === "boolean") p.showInPlaza = b.showInPlaza;
  if (Array.isArray(b.tags)) p.tags = b.tags.map((t: unknown) => clean(t, 16)).filter(Boolean).slice(0, 3);
  if (p.petStatus !== "먼저 떠났어요") p.passed = "";
  return null;
}
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstDayEnd = () => Date.parse(kstDay() + "T23:59:59+09:00");
function touch(p: Pet) { p.lastActive = new Date().toISOString(); }
function flowersOf(p: Pet) { return { today: p.flowerDay === kstDay() ? p.flowersToday || 0 : 0, total: p.flowersTotal || 0 }; }
// 공개 메모리얼에 보이는 정보 (연락처·계정 정보 없음)
const publicPet = (p: Pet) => ({
  id: p.id, name: p.name, kind: p.kind, breed: p.breed, nickname: p.nickname, birth: p.birth, passed: p.passed, petStatus: p.petStatus,
  likes: p.likes, tags: p.tags, weight: p.weight, photo: p.photoV ? `/photo/${p.id}.jpg?v=${p.photoV}` : "",
  hall: p.hall, hallName: HALLS.find((h) => h.id === p.hall)?.name || "", seats: p.seats,
  flowers: flowersOf(p), candle: (p.candleUntil || 0) > Date.now(),
});
const petView = (p: Pet) => ({
  ...p,
  photo: p.photoV ? `/photo/${p.id}.jpg?v=${p.photoV}` : "",
  hallName: HALLS.find((h) => h.id === p.hall)?.name || "",
  showInPlaza: p.showInPlaza !== false, flowers: flowersOf(p), candle: (p.candleUntil || 0) > Date.now(),
});
function decodeJpeg(dataUrl: unknown): Uint8Array | string {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return "사진을 다시 골라 주세요";
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > MAX_PHOTO_BYTES) return "사진이 너무 커요. 3MB 이하로 골라 주세요";
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return "사진을 다시 골라 주세요";
  return new Uint8Array(buf);
}

// ---------- pages & static ----------
const PAGES: Record<string, string> = { "/": "guest.html", "/start": "index.html", "/guest": "guest.html", "/member": "member.html", "/admin": "admin.html", "/privacy": "privacy.html" };
const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// 공개 메모리얼 /m/:id — 링크 미리보기(카카오톡 등)를 위해 아이 이름·사진을 메타 태그로 넣어 준다
async function serveMemorial(req: Request, id: string): Promise<Response> {
  await load();
  const pet = state!.pets.find((p) => p.id === id);
  const file = Bun.file(join(PUBLIC_DIR, "memorial.html"));
  let html = await file.text();
  const origin = new URL(req.url).origin.replace(/^http:/, req.headers.get("x-forwarded-proto") === "https" ? "https:" : "http:");
  const title = pet ? `${pet.name}의 메모리얼 · 기억의 집` : "기억의 집";
  const desc = pet ? "1004의 별이 모여 하나의 빛이 됩니다. 꽃 한 송이, 한 마디를 남겨 주세요." : "메모리얼을 찾을 수 없어요";
  const img = pet?.photoV ? `${origin}/photo/${pet.id}.jpg?v=${pet.photoV}` : `${origin}/img/portrait.jpg`;
  const og = `<title>${escHtml(title)}</title><meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}"><meta property="og:image" content="${escHtml(img)}"><meta property="og:type" content="website"><meta name="description" content="${escHtml(desc)}">`;
  html = html.replace("<!--OG-->", og);
  return new Response(html, { status: pet ? 200 : 404, headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
const SECURITY_HEADERS = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };

async function serveStatic(path: string): Promise<Response | null> {
  const page = PAGES[path];
  let rel: string;
  if (page) rel = page;
  else if (/^\/(img|static)\/[a-z0-9_.-]+$/.test(path)) rel = path.slice(1);
  else return null;
  const full = normalize(join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR)) return null;
  const file = Bun.file(full);
  if (!(await file.exists())) return null;
  const extra: Record<string, string> = page ? { "cache-control": "no-cache" } : { "cache-control": rel.startsWith("img/") ? "public, max-age=86400" : "public, max-age=300" };
  if (path === "/admin") extra["x-robots-tag"] = "noindex";
  return new Response(file, { headers: { ...SECURITY_HEADERS, ...extra } });
}

// ---------- API ----------
async function api(req: Request, url: URL, path: string): Promise<Response> {
  const s = await load();

  if (req.method === "GET" && path === "/api/halls") return json(HALLS.map(hallSummary));

  let m = path.match(/^\/api\/halls\/(\w+)\/seats$/);
  if (req.method === "GET" && m) {
    const h = HALLS.find((x) => x.id === m![1]);
    if (!h) return bad("없는 메모리얼이에요", 404);
    return json({ ...hallSummary(h), taken: [...takenFor(h.id)].sort((a, b) => a - b) });
  }

  // 자리 예약: 비회원은 여기서 계정이 만들어지고, 회원은 로그인된 계정에 붙는다
  if (req.method === "POST" && path === "/api/reserve") {
    const b = await body(req);
    const h = HALLS.find((x) => x.id === b.hall);
    if (!h) return bad("메모리얼을 다시 골라 주세요");
    const seats: number[] = Array.isArray(b.seats) ? [...new Set<number>(b.seats.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL) : [];
    if (!seats.length || seats.length > 2) return bad("자리를 한두 곳 골라 주세요");
    if (seats.some((n) => takenFor(h.id).has(n))) return bad("방금 다른 분이 고른 자리예요. 다른 자리를 골라 주세요", 409);

    // 시연용 '보리' 화면에서의 예약은 계정 없이 기록만 한다
    if (b.source === "demo") {
      const r: Reservation = { id: nextId("R"), at: new Date().toISOString(), hall: h.id, seats, seatLabel: clean(b.seatLabel, 20) || undefined, pet: "보리", kind: "말티즈", petStatus: "먼저 떠났어요", owner: "김지현", phone: "01023457788", source: "member", status: "active" };
      s.reservations.unshift(r);
      await save();
      return json({ reservation: { id: r.id, hall: r.hall, seats: r.seats }, hall: hallSummary(h) });
    }

    let account = accountOf(req);
    let pet: Pet | undefined;
    let setCookie: string | undefined;
    if (account) {
      pet = s.pets.find((p) => p.accountId === account!.id && p.id === b.petId) || s.pets.find((p) => p.accountId === account!.id);
    }
    if (!pet) {
      const name = clean(b.pet, 20), owner = clean(b.owner, 20), phone = digits(b.phone), password = String(b.password ?? "");
      if (!name || (!account && !owner)) return bad("아이 이름과 보호자 이름을 적어 주세요");
      if (!account) {
        if (!isPhone(phone)) return bad("휴대폰 번호 10~11자리를 확인해 주세요");
        if (password.length < 6 || password.length > 64) return bad("비밀번호는 6자 이상으로 정해 주세요");
        const existing = s.accounts.find((a) => a.phone === phone);
        if (existing) {
          if (!(await Bun.password.verify(password, existing.pwHash))) return bad("이미 가입된 번호예요. 그때 정한 비밀번호를 넣어 주세요", 409);
          account = existing;
        } else {
          if (b.agree !== true) return bad("개인정보 수집·이용에 동의해 주세요");
          account = { id: nextId("A"), at: new Date().toISOString(), owner, phone, pwHash: await Bun.password.hash(password), agreedAt: new Date().toISOString() };
          s.accounts.push(account);
        }
        setCookie = startSession(req, account.id);
      }
      pet = {
        id: nextId("P"), accountId: account.id, at: new Date().toISOString(), name, kind: clean(b.kind, 20) || "-", breed: "",
        petStatus: clean(b.petStatus, 20) || "-", nickname: "", birth: "", passed: "", weight: "", likes: "", tags: [],
        photoV: 0, hall: h.id, seats: [], showInPlaza: true, lastActive: new Date().toISOString(),
      };
      s.pets.push(pet);
    }
    if (!pet.hall) pet.hall = h.id;
    if (pet.hall === h.id) pet.seats.push(...seats);
    const r: Reservation = {
      id: nextId("R"), at: new Date().toISOString(), hall: h.id, seats, seatLabel: clean(b.seatLabel, 20) || undefined,
      pet: pet.name, kind: pet.kind, petStatus: pet.petStatus, owner: account!.owner, phone: account!.phone,
      source: b.source === "member" ? "member" : "guest", status: "active", accountId: account!.id, petId: pet.id,
    };
    s.reservations.unshift(r);
    await save();
    return json({ reservation: { id: r.id, hall: r.hall, seats: r.seats }, pet: petView(pet), hall: hallSummary(h) }, 200, setCookie ? { "set-cookie": setCookie } : {});
  }

  if (req.method === "POST" && path === "/api/login") {
    const b = await body(req);
    const phone = digits(b.phone), password = String(b.password ?? "");
    const a = s.accounts.find((x) => x.phone === phone);
    if (!a || !(await Bun.password.verify(password, a.pwHash))) return bad("휴대폰 번호나 비밀번호가 맞지 않아요", 401);
    const cookie = startSession(req, a.id);
    await save();
    return json({ ok: true }, 200, { "set-cookie": cookie });
  }
  if (req.method === "POST" && path === "/api/logout") {
    const token = cookieOf(req, SESSION_COOKIE);
    if (token && s.sessions[token]) { delete s.sessions[token]; await save(); }
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(req, "", 0) });
  }

  // ---- 회원 본인 ----
  if (path === "/api/me" || path.startsWith("/api/me/")) {
    const a = accountOf(req);
    if (!a) return bad("로그인이 필요해요", 401);
    const mine = s.pets.filter((p) => p.accountId === a.id);
    if (req.method === "GET" && path === "/api/me") {
      return json({ account: { owner: a.owner, phone: a.phone.slice(0, 3) + "-****-" + a.phone.slice(-4) }, pets: mine.map(petView) });
    }
    if (req.method === "PUT" && path === "/api/me/password") {
      const b = await body(req);
      if (!(await Bun.password.verify(String(b.current ?? ""), a.pwHash))) return bad("지금 비밀번호가 맞지 않아요");
      const next = String(b.next ?? "");
      if (next.length < 6 || next.length > 64) return bad("새 비밀번호는 6자 이상으로 정해 주세요");
      a.pwHash = await Bun.password.hash(next);
      const keep = cookieOf(req, SESSION_COOKIE);
      for (const [t, ss] of Object.entries(s.sessions)) if (ss.accountId === a.id && t !== keep) delete s.sessions[t];
      await save();
      return json({ ok: true });
    }
    m = path.match(/^\/api\/me\/pets\/([\w-]+)(\/photo|\/feed)?$/);
    const pet = m && mine.find((p) => p.id === m![1]);
    if (m && !pet) return bad("아이를 찾을 수 없어요", 404);
    if (pet && req.method === "PUT" && !m![2]) {
      const err = applyPetFields(pet, await body(req));
      if (err) return bad(err);
      await save();
      return json({ pet: petView(pet) });
    }
    if (pet && req.method === "PUT" && m![2] === "/photo") {
      const bytes = decodeJpeg((await body(req)).image);
      if (typeof bytes === "string") return bad(bytes);
      await storage.writeBytes(`photos/${pet.id}.jpg`, bytes, "image/jpeg");
      pet.photoV = Date.now();
      await save();
      return json({ pet: petView(pet) });
    }
    if (pet && m![2] === "/feed") {
      if (req.method === "GET") return json(s.feed.filter((f) => f.petId === pet.id).map((f) => ({ ...f, photo: f.photoV ? `/photo/${f.id}.jpg?v=${f.photoV}` : "" })));
      if (req.method === "POST") {
        const b = await body(req);
        const text = clean(b.text, 300);
        let bytes: Uint8Array | null = null;
        if (b.image) {
          const d = decodeJpeg(b.image);
          if (typeof d === "string") return bad(d);
          bytes = d;
        }
        if (!text && !bytes) return bad("사진을 고르거나 한 줄을 적어 주세요");
        const f: FeedItem = { id: nextId("F"), at: new Date().toISOString(), petId: pet.id, who: clean(b.who, 20) || a.owner, text, photoV: 0 };
        if (bytes) { await storage.writeBytes(`photos/${f.id}.jpg`, bytes, "image/jpeg"); f.photoV = Date.now(); }
        s.feed.unshift(f);
        await save();
        return json({ item: { ...f, photo: f.photoV ? `/photo/${f.id}.jpg?v=${f.photoV}` : "" } });
      }
    }
    return bad("찾을 수 없어요", 404);
  }

  // ---- 공개 메모리얼 (가족·지인이 링크로 방문) ----
  m = path.match(/^\/api\/pets\/([\w-]+)(\/flower|\/candle)?$/);
  if (m) {
    const pet = s.pets.find((p) => p.id === m![1]);
    if (!pet) return bad("메모리얼을 찾을 수 없어요", 404);
    if (req.method === "GET" && !m[2]) return json(publicPet(pet));
    if (req.method === "POST" && m[2] === "/flower") {
      if (pet.flowerDay !== kstDay()) { pet.flowerDay = kstDay(); pet.flowersToday = 0; }
      pet.flowersToday = (pet.flowersToday || 0) + 1;
      pet.flowersTotal = (pet.flowersTotal || 0) + 1;
      touch(pet);
      await save();
      return json({ flowers: flowersOf(pet) });
    }
    if (req.method === "POST" && m[2] === "/candle") {
      const b = await body(req);
      pet.candleUntil = b.on === false ? 0 : kstDayEnd();
      touch(pet);
      await save();
      return json({ candle: (pet.candleUntil || 0) > Date.now() });
    }
  }
  if (req.method === "GET" && path === "/api/plaza") {
    const notes = (p: Pet) => {
      const today = kstDay();
      if (p.flowerDay === today && (p.flowersToday || 0) > 0) return "오늘 꽃이 놓였어요";
      if (s.guestbook.some((g) => g.pet === p.id && !g.hidden && g.at.slice(0, 10) === today)) return "가족이 편지를 남겼어요";
      if ((p.candleUntil || 0) > Date.now()) return "촛불이 켜져 있어요";
      return "별이 되어 빛나고 있어요";
    };
    const list = s.pets
      .filter((p) => p.photoV && p.showInPlaza !== false)
      .sort((a, b) => (b.lastActive || b.at).localeCompare(a.lastActive || a.at))
      .slice(0, 12)
      .map((p) => ({ id: p.id, name: p.name, kind: p.breed || p.kind, hallName: HALLS.find((h) => h.id === p.hall)?.name || "", photo: `/photo/${p.id}.jpg?v=${p.photoV}`, note: notes(p) }));
    return json(list);
  }

  if (req.method === "POST" && path === "/api/transfer") {
    const b = await body(req);
    const toPhone = digits(b.toPhone);
    if (!isPhone(toPhone)) return bad("휴대폰 번호 10~11자리를 확인해 주세요");
    const a = accountOf(req);
    const ownPet = a ? s.pets.find((p) => p.accountId === a.id && p.id === b.petId) : undefined;
    const t: Transfer = { id: nextId("T"), at: new Date().toISOString(), seatLabel: clean(b.seatLabel, 30) || "-", fromName: a?.owner || clean(b.fromName, 20) || "-", toPhone, status: "pending", accountId: a?.id, petId: ownPet?.id };
    s.transfers.unshift(t);
    await save();
    return json({ transfer: { id: t.id, status: t.status } });
  }

  if (req.method === "GET" && path === "/api/guestbook") {
    const pet = url.searchParams.get("pet") || "";
    return json(s.guestbook.filter((g) => !g.hidden && (!pet || g.pet === pet)).map(({ id, at, pet, who, text }) => ({ id, at, pet, who, text })));
  }
  if (req.method === "POST" && path === "/api/guestbook") {
    const b = await body(req);
    const text = clean(b.text, 200);
    if (!text) return bad("남길 말을 한 글자 이상 적어 주세요");
    const g: Guest = { id: nextId("G"), at: new Date().toISOString(), pet: clean(b.pet, 20) || "보리", who: clean(b.who, 20) || "나", text, hidden: false, reports: 0 };
    s.guestbook.unshift(g);
    const gp = s.pets.find((p) => p.id === g.pet);
    if (gp) touch(gp);
    await save();
    return json({ entry: { id: g.id, at: g.at, pet: g.pet, who: g.who, text: g.text } });
  }

  // ---- admin ----
  if (path.startsWith("/api/admin/")) {
    if (!Bun.env.ADMIN_CODE) return bad("관리자 코드가 설정되지 않았어요. 서버의 ADMIN_CODE를 확인해 주세요", 503);
    if (!isAdmin(req)) return bad("관리자 코드를 확인해 주세요", 401);

    if (req.method === "GET" && path === "/api/admin/overview") {
      const petName = (id: string) => s.pets.find((p) => p.id === id)?.name || id;
      return json({
        halls: HALLS.map((h) => ({ ...hallSummary(h), takenSeats: [...takenFor(h.id)] })),
        reservations: s.reservations, transfers: s.transfers,
        guestbook: s.guestbook.map((g) => ({ ...g, pet: g.pet.startsWith("P-") ? petName(g.pet) : g.pet })),
        pets: s.pets.map(petView), accounts: s.accounts.length,
        members: s.accounts.map((a) => ({ id: a.id, at: a.at, owner: a.owner, phone: a.phone, agreedAt: a.agreedAt || "", pets: s.pets.filter((p) => p.accountId === a.id).map((p) => ({ id: p.id, name: p.name, hallName: HALLS.find((h) => h.id === p.hall)?.name || "", seats: p.seats })) })),
      });
    }
    if (req.method === "POST" && path === "/api/admin/reset") {
      state = seedState();
      await save();
      return json({ ok: true });
    }
    m = path.match(/^\/api\/admin\/accounts\/([\w-]+)\/password$/);
    if (req.method === "POST" && m) {
      const a = s.accounts.find((x) => x.id === m![1]);
      if (!a) return bad("없는 회원이에요", 404);
      const chars = "abcdefghjkmnpqrstuvwxyz23456789";
      const temp = Array.from(randomBytes(8), (x) => chars[x % chars.length]).join("");
      a.pwHash = await Bun.password.hash(temp);
      for (const [t, ss] of Object.entries(s.sessions)) if (ss.accountId === a.id) delete s.sessions[t];
      await save();
      return json({ temp });
    }
    m = path.match(/^\/api\/admin\/transfers\/([\w-]+)$/);
    if (req.method === "POST" && m) {
      const t = s.transfers.find((x) => x.id === m![1]);
      if (!t) return bad("없는 요청이에요", 404);
      if (t.status !== "pending") return bad("이미 처리된 요청이에요", 409);
      const b = await body(req);
      t.status = b.action === "approve" ? "approved" : "rejected";
      t.decidedAt = new Date().toISOString();
      await save();
      return json({ transfer: t });
    }
    m = path.match(/^\/api\/admin\/guestbook\/([\w-]+)$/);
    if (req.method === "POST" && m) {
      const g = s.guestbook.find((x) => x.id === m![1]);
      if (!g) return bad("없는 글이에요", 404);
      const b = await body(req);
      g.hidden = !!b.hidden;
      await save();
      return json({ entry: g });
    }
    m = path.match(/^\/api\/admin\/reservations\/([\w-]+)$/);
    if (req.method === "POST" && m) {
      const r = s.reservations.find((x) => x.id === m![1]);
      if (!r) return bad("없는 예약이에요", 404);
      const b = await body(req);
      if (b.action === "cancel") r.status = "cancelled";
      if (b.action === "restore") {
        if (r.source !== "seed" && r.seats.some((n) => takenFor(r.hall).has(n))) return bad("그 사이 다른 분이 예약한 자리라 되돌릴 수 없어요", 409);
        r.status = "active";
      }
      await save();
      return json({ reservation: r });
    }
  }
  return bad("찾을 수 없어요", 404);
}

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  maxRequestBodySize: 6 * 1024 * 1024,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/healthz") return new Response("ok");
    if (path.startsWith("/api/")) {
      if (req.method !== "GET") {
        const ip = ipOf(req, srv);
        if (limited(ip, 40) || (path === "/api/login" && limited("login:" + ip, 10))) return bad("요청이 너무 많아요. 잠시 후 다시 시도해 주세요", 429);
      }
      try {
        return await api(req, url, path);
      } catch (e) {
        console.error("API 오류", path, e);
        return bad("잠시 후 다시 시도해 주세요", 500);
      }
    }
    const mem = path.match(/^\/m\/([\w-]+)$/);
    if (mem && req.method === "GET") return serveMemorial(req, mem[1]);
    const photo = path.match(/^\/photo\/([\w-]+)\.jpg$/);
    if (photo && req.method === "GET") {
      const bytes = await storage.readBytes(`photos/${photo[1]}.jpg`);
      if (!bytes) return new Response("사진이 없어요", { status: 404 });
      return new Response(bytes, { headers: { ...SECURITY_HEADERS, "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("허용되지 않는 요청이에요", { status: 405 });
    return (await serveStatic(path)) ?? new Response("페이지를 찾을 수 없어요", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
});

console.log(`기억의 집 서버 시작 · 포트 ${server.port} · 데이터 저장소: ${storage.kind}${Bun.env.ADMIN_CODE ? "" : " · 경고: ADMIN_CODE 없음(관리자 페이지 잠김)"}`);
