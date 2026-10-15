// 기억의 집 서버: 화면(public/)과 API를 함께 제공한다.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join, normalize } from "node:path";
import {
  baseOf, dayOf, HALLS, TOTAL, seedState,
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

// ---------- 탈퇴·양도 후 정리 ----------
// 탈퇴하거나 자리를 양도하면 그 메모리얼은 모두 사라진다. 다만 마음이 바뀌거나 양도가 잘못될 수 있어
// 30일(GRACE_MS) 동안 보관했다가 자동으로 지운다. 그 사이에는 취소·되돌리기가 된다.
const GRACE_MS = Number(Bun.env.GRACE_MS) || 30 * 864e5;
const graceEnd = () => new Date(Date.now() + GRACE_MS).toISOString();
const activeRes = (accountId: string | undefined, hall: string, seat: number) =>
  state!.reservations.find((r) => r.status === "active" && r.hall === hall && r.seats.includes(seat) && (!accountId || r.accountId === accountId));

function moveSeat(r: Reservation, seat: number, to: { accountId: string; owner: string; phone: string; petId: string; pet: string; kind: string; petStatus: string }) {
  if (r.seats.length === 1) {
    Object.assign(r, { accountId: to.accountId, owner: to.owner, phone: to.phone, petId: to.petId, pet: to.pet, kind: to.kind, petStatus: to.petStatus });
    return r.id;
  }
  r.seats = r.seats.filter((n) => n !== seat);
  const nr: Reservation = { id: nextId("R"), at: new Date().toISOString(), hall: r.hall, seats: [seat], pet: to.pet, kind: to.kind, petStatus: to.petStatus, owner: to.owner, phone: to.phone, source: "member", status: "active", accountId: to.accountId, petId: to.petId };
  state!.reservations.unshift(nr);
  return nr.id;
}

async function approveTransfer(t: Transfer): Promise<string | null> {
  const s = state!;
  const from = s.accounts.find((a) => a.id === t.accountId);
  const to = s.accounts.find((a) => a.id === t.toAccountId);
  const pet = s.pets.find((p) => p.id === t.petId);
  if (!from || !pet || t.seat === undefined || !t.hall) return "양도할 자리 정보가 없어요";
  if (!to || to.deleteAt) return "받는 분이 회원이 아니거나 탈퇴 중이에요";
  const r = activeRes(from.id, t.hall, t.seat);
  if (!r || !pet.seats.includes(t.seat)) return "이미 정리된 자리예요";
  // 받는 분에게는 이 자리를 가진 새 아이 메모리얼이 생기고, 이름·정보는 받는 분이 채운다
  const np: Pet = {
    id: nextId("P"), accountId: to.id, at: new Date().toISOString(), name: "새 아이", kind: "-", breed: "", petStatus: "-",
    nickname: "", birth: "", passed: "", weight: "", likes: "", tags: [], photoV: 0, hall: t.hall, seats: [t.seat], showInPlaza: true, lastActive: new Date().toISOString(),
  };
  s.pets.push(np);
  t.reservationId = moveSeat(r, t.seat, { accountId: to.id, owner: to.owner, phone: to.phone, petId: np.id, pet: np.name, kind: "-", petStatus: "-" });
  pet.seats = pet.seats.filter((n) => n !== t.seat);
  if (!pet.seats.length) { pet.deleteAt = graceEnd(); pet.deleteReason = "transfer"; }
  t.toPetId = np.id;
  t.deleteAt = pet.deleteAt;
  return null;
}

function revertTransfer(t: Transfer): string | null {
  const s = state!;
  const pet = s.pets.find((p) => p.id === t.petId);
  const from = s.accounts.find((a) => a.id === t.accountId);
  const np = s.pets.find((p) => p.id === t.toPetId);
  if (!pet || !from || t.seat === undefined || !t.hall) return "보관 기간이 지나 되돌릴 수 없어요";
  const r = activeRes(t.toAccountId, t.hall, t.seat);
  if (!r) return "받는 분 쪽 자리를 찾을 수 없어요";
  moveSeat(r, t.seat, { accountId: from.id, owner: from.owner, phone: from.phone, petId: pet.id, pet: pet.name, kind: pet.kind, petStatus: pet.petStatus });
  pet.seats.push(t.seat);
  if (pet.deleteReason === "transfer") { delete pet.deleteAt; delete pet.deleteReason; }
  if (np) {
    np.seats = np.seats.filter((n) => n !== t.seat);
    if (!np.seats.length && np.name === "새 아이" && !np.photoV) s.pets = s.pets.filter((p) => p.id !== np.id);
  }
  return null;
}

async function erasePet(p: Pet) {
  const s = state!;
  await storage.remove(`photos/${p.id}.jpg`);
  for (const f of s.feed.filter((f) => f.petId === p.id)) if (f.photoV) await storage.remove(`photos/${f.id}.jpg`);
  s.feed = s.feed.filter((f) => f.petId !== p.id);
  s.guestbook = s.guestbook.filter((g) => g.pet !== p.id);
  for (const r of s.reservations) {
    if (r.petId !== p.id) continue;
    r.status = "cancelled";
    r.pet = "(삭제됨)"; r.owner = "(삭제됨)"; r.phone = "";
    delete r.petId;
  }
  s.pets = s.pets.filter((x) => x.id !== p.id);
}

// 보관 기간이 끝난 메모리얼과 계정을 지운다
async function purge(): Promise<{ pets: number; accounts: number }> {
  await load();
  const s = state!;
  const now = new Date().toISOString();
  let pets = 0, accounts = 0;
  for (const p of s.pets.filter((p) => p.deleteAt && p.deleteAt <= now)) { await erasePet(p); pets++; }
  for (const a of s.accounts.filter((a) => a.deleteAt && a.deleteAt <= now)) {
    for (const p of s.pets.filter((p) => p.accountId === a.id)) { await erasePet(p); pets++; }
    for (const r of s.reservations) if (r.accountId === a.id) { r.status = "cancelled"; r.owner = "(탈퇴)"; r.phone = ""; delete r.accountId; }
    for (const t of s.transfers) { if (t.accountId === a.id || t.toAccountId === a.id) { t.toPhone = ""; t.fromName = t.accountId === a.id ? "(탈퇴)" : t.fromName; } }
    for (const [k, ss] of Object.entries(s.sessions)) if (ss.accountId === a.id) delete s.sessions[k];
    s.accounts = s.accounts.filter((x) => x.id !== a.id);
    accounts++;
  }
  if (pets || accounts) { await save(); console.log(`정리 완료 · 메모리얼 ${pets} · 계정 ${accounts}`); }
  return { pets, accounts };
}
setInterval(() => { purge().catch((e) => console.error("정리 실패", String(e))); }, Math.min(10 * 60_000, Math.max(1000, GRACE_MS / 2)));

function takenFor(hallId: string): Set<number> {
  const set = new Set(baseOf(hallId));
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

// 비회원이면 계정을 만들고(같은 번호면 비밀번호 확인), 회원이면 그 계정을 쓴다
async function accountFor(req: Request, b: any): Promise<{ account: Account; setCookie?: string } | Response> {
  const s = state!;
  const cur = accountOf(req);
  if (cur) return cur.deleteAt ? bad("탈퇴 신청 중이에요. 탈퇴를 취소하면 다시 함께할 수 있어요") : { account: cur };
  const owner = clean(b.owner, 20), phone = digits(b.phone), password = String(b.password ?? "");
  if (!owner) return bad("보호자 이름을 적어 주세요");
  if (!isPhone(phone)) return bad("휴대폰 번호 10~11자리를 확인해 주세요");
  if (password.length < 6 || password.length > 64) return bad("비밀번호는 6자 이상으로 정해 주세요");
  let account = s.accounts.find((a) => a.phone === phone);
  if (account) {
    if (!(await Bun.password.verify(password, account.pwHash))) return bad("이미 가입된 번호예요. 그때 정한 비밀번호를 넣어 주세요", 409);
    if (account.deleteAt) return bad("탈퇴 신청 중이에요. 탈퇴를 취소하면 다시 함께할 수 있어요");
  } else {
    if (b.agree !== true) return bad("개인정보 수집·이용에 동의해 주세요");
    account = { id: nextId("A"), at: new Date().toISOString(), owner, phone, pwHash: await Bun.password.hash(password), agreedAt: new Date().toISOString() };
    s.accounts.push(account);
  }
  return { account, setCookie: startSession(req, account.id) };
}
const newPet = (accountId: string, name: string, petStatus: string, passed: string, hall: string): Pet => ({
  id: nextId("P"), accountId, at: new Date().toISOString(), name, kind: "-", breed: "", petStatus, nickname: "", birth: "", passed, weight: "", likes: "", tags: [],
  photoV: 0, hall, seats: [], showInPlaza: true, lastActive: new Date().toISOString(), dayLocked: petStatus === "먼저 떠났어요",
});

// ---------- pets ----------
const PET_FIELDS = { nickname: 20, birth: 10, passed: 10, weight: 10, likes: 60, breed: 30, kind: 20, petStatus: 20, name: 20 } as const;
function applyPetFields(target: Pet, b: any): string | null {
  const p: Pet = { ...target, tags: [...(target.tags || [])] };
  for (const [k, max] of Object.entries(PET_FIELDS)) {
    if (b[k] === undefined) continue;
    const v = clean(b[k], max);
    if ((k === "birth" || k === "passed") && !isDate(v)) return "날짜를 다시 확인해 주세요";
    if (k === "name" && !v) return "아이 이름을 적어 주세요";
    (p as any)[k] = v;
  }
  if (p.birth && p.passed && p.passed < p.birth) return "천사를 만난 날이 태어난 날보다 앞설 수 없어요";
  if (b.weight !== undefined && p.weight && !/^\d{1,3}(\.\d{1,2})?$/.test(p.weight)) return "무게는 숫자로 적어 주세요 (예: 3.2)";
  if (typeof b.showInPlaza === "boolean") p.showInPlaza = b.showInPlaza;
  if (Array.isArray(b.tags)) p.tags = b.tags.map((t: unknown) => clean(t, 16)).filter(Boolean).slice(0, 3);
  if (p.petStatus !== "먼저 떠났어요") p.passed = "";
  // 함께 살던 아이가 떠났다는 소식은 '천사를 만난 날 알리기'(한 번만 날짜 변경)로만 받는다
  if (!target.dayLocked && target.petStatus !== "먼저 떠났어요" && p.petStatus === "먼저 떠났어요")
    return "아이가 천사를 만났다면 '아이가 천사를 만났다면'에서 알려 주세요";
  // 천사를 만난 날이 정해진 메모리얼은 날짜를 바꿀 수 없다
  if (p.dayLocked) {
    const day = HALLS.find((h) => h.id === p.hall)?.name || "";
    if (p.petStatus !== "먼저 떠났어요") return "천사를 만난 날이 정해진 아이예요. 잘못 들어갔다면 운영팀에 알려 주세요";
    if (dayOf(p.passed) !== p.hall) return `천사를 만난 날은 이미 정해졌어요(${day}). 잘못 들어갔다면 운영팀에 알려 주세요`;
  }
  Object.assign(target, p);
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
  const title = pet ? `${pet.name}의 ${pet.petStatus === "먼저 떠났어요" ? "메모리얼" : "사랑 저장소"} · 기억의 집` : "기억의 집";
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

  let m = path.match(/^\/api\/halls\/([\d-]+)\/seats$/);
  if (req.method === "GET" && m) {
    const h = HALLS.find((x) => x.id === m![1]);
    if (!h) return bad("없는 메모리얼이에요", 404);
    return json({ ...hallSummary(h), taken: [...takenFor(h.id)].sort((a, b) => a - b) });
  }

  // 아직 곁에 있는 아이: 날짜도 자리도 없이 '준비된 사랑꾼'으로 함께한다
  if (req.method === "POST" && path === "/api/join") {
    const b = await body(req);
    const name = clean(b.pet, 20);
    if (!name) return bad("아이 이름을 적어 주세요");
    const got = await accountFor(req, b);
    if (got instanceof Response) return got;
    const pet = newPet(got.account.id, name, "함께 살고 있어요", "", "");
    s.pets.push(pet);
    await save();
    return json({ pet: petView(pet) }, 200, got.setCookie ? { "set-cookie": got.setCookie } : {});
  }

  // 자리 예약(먼저 떠난 아이): 비회원은 여기서 계정이 만들어지고, 회원은 로그인된 계정에 붙는다
  if (req.method === "POST" && path === "/api/reserve") {
    const b = await body(req);
    const h = HALLS.find((x) => x.id === b.hall);
    if (!h) return bad("메모리얼을 다시 골라 주세요");
    const seats: number[] = Array.isArray(b.seats) ? [...new Set<number>(b.seats.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL) : [];
    if (!seats.length || seats.length > 2) return bad("자리를 한두 곳 골라 주세요");
    if (takenFor(h.id).size >= TOTAL) return bad(`${h.name}의 천사 곁은 이미 가득 찼어요. 그날로는 모실 수 없어요`, 409);
    if (seats.some((n) => takenFor(h.id).has(n))) return bad("방금 다른 분이 고른 자리예요. 다른 자리를 골라 주세요", 409);

    // 시연용 '보리' 화면에서의 예약은 계정 없이 기록만 한다
    if (b.source === "demo") {
      const r: Reservation = { id: nextId("R"), at: new Date().toISOString(), hall: h.id, seats, seatLabel: clean(b.seatLabel, 20) || undefined, pet: "보리", kind: "말티즈", petStatus: "먼저 떠났어요", owner: "김지현", phone: "01023457788", source: "member", status: "active" };
      s.reservations.unshift(r);
      await save();
      return json({ reservation: { id: r.id, hall: r.hall, seats: r.seats }, hall: hallSummary(h) });
    }

    let pet: Pet | undefined;
    const me = accountOf(req);
    if (me && b.petId) {
      pet = s.pets.find((p) => p.accountId === me.id && p.id === b.petId);
      if (!pet) return bad("아이를 찾을 수 없어요", 404);
      if (!pet.dayLocked || !pet.hall) return bad("아직 곁에 있는 아이는 날짜를 정하지 않아요. 천사를 만난 날에 알려 주세요");
      if (pet.hall !== h.id) return bad(`${pet.name}의 메모리얼은 ${HALLS.find((x) => x.id === pet!.hall)?.name}이에요. 그날에만 자리를 더 잡을 수 있어요`);
      if (me.deleteAt) return bad("탈퇴 신청 중에는 자리를 잡을 수 없어요. 탈퇴를 취소하면 다시 할 수 있어요");
    }
    let account: Account | undefined = me && pet ? me : undefined;
    let setCookie: string | undefined;
    if (!pet) {
      // 자리는 먼저 떠난 아이만, 천사를 만난 날(떠난 날)의 메모리얼에만
      if (b.petStatus !== "먼저 떠났어요") return bad("아직 곁에 있는 아이는 날짜를 정하지 않아요. 준비된 사랑꾼으로 함께해 주세요");
      const passed = clean(b.passed, 10);
      if (!isDate(passed) || !passed) return bad("아이가 천사를 만난 날을 알려 주세요");
      if (passed > kstDay()) return bad("천사를 만난 날은 오늘보다 앞이어야 해요");
      if (dayOf(passed) !== h.id) return bad(`천사를 만난 날(${passed.replace(/-/g, ".")})과 메모리얼 날짜(${h.name})가 달라요`);
      const name = clean(b.pet, 20);
      if (!name) return bad("아이 이름과 보호자 이름을 적어 주세요");
      const got = await accountFor(req, b);
      if (got instanceof Response) return got;
      account = got.account; setCookie = got.setCookie;
      pet = newPet(account.id, name, "먼저 떠났어요", passed, h.id);
      s.pets.push(pet);
    }
    pet.seats.push(...seats);
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
      const myTransfers = s.transfers.filter((t) => t.accountId === a.id && (t.status === "pending" || (t.status === "approved" && t.deleteAt && t.deleteAt > new Date().toISOString())))
        .map((t) => ({ id: t.id, at: t.at, status: t.status, seatLabel: t.seatLabel, petId: t.petId, toPhone: t.toPhone.slice(0, 3) + "-****-" + t.toPhone.slice(-4), deleteAt: t.deleteAt || "" }));
      return json({ account: { owner: a.owner, phone: a.phone.slice(0, 3) + "-****-" + a.phone.slice(-4), deleteAt: a.deleteAt || "" }, pets: mine.map(petView), transfers: myTransfers });
    }
    if (req.method === "POST" && path === "/api/me/withdraw") {
      const b = await body(req);
      if (b.agree !== true) return bad("모든 메모리얼이 사라진다는 데 동의해 주세요");
      if (!(await Bun.password.verify(String(b.password ?? ""), a.pwHash))) return bad("비밀번호가 맞지 않아요");
      a.deleteAt = graceEnd();
      a.withdrawConsentAt = new Date().toISOString();
      for (const p of mine) if (!p.deleteAt) { p.deleteAt = a.deleteAt; p.deleteReason = "withdraw"; }
      for (const t of s.transfers) if (t.accountId === a.id && t.status === "pending") { t.status = "cancelled"; t.decidedAt = new Date().toISOString(); }
      await save();
      return json({ deleteAt: a.deleteAt });
    }
    if (req.method === "POST" && path === "/api/me/withdraw/cancel") {
      if (!a.deleteAt) return bad("탈퇴 신청이 없어요");
      delete a.deleteAt;
      for (const p of mine) if (p.deleteReason === "withdraw") { delete p.deleteAt; delete p.deleteReason; }
      await save();
      return json({ ok: true });
    }
    m = path.match(/^\/api\/me\/transfers\/([\w-]+)\/cancel$/);
    if (req.method === "POST" && m) {
      const t = s.transfers.find((x) => x.id === m![1] && x.accountId === a.id);
      if (!t) return bad("없는 요청이에요", 404);
      if (t.status !== "pending") return bad("운영팀이 이미 처리한 요청이에요. 되돌리려면 운영팀에 알려 주세요", 409);
      t.status = "cancelled";
      t.decidedAt = new Date().toISOString();
      await save();
      return json({ ok: true });
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
    // 곁에 있던 아이가 천사를 만났을 때: 그날의 천사 곁에 자리를 마련한다(한 번). 그날이 다 찼으면 들어갈 수 없다
    m = path.match(/^\/api\/me\/pets\/([\w-]+)\/angel-day$/);
    if (req.method === "POST" && m) {
      const pet = mine.find((p) => p.id === m![1]);
      if (!pet) return bad("아이를 찾을 수 없어요", 404);
      if (pet.dayLocked || pet.petStatus === "먼저 떠났어요") return bad("천사를 만난 날이 이미 정해졌어요", 409);
      if (a.deleteAt || pet.deleteAt) return bad("탈퇴·양도 중에는 날짜를 정할 수 없어요", 409);
      const b = await body(req);
      const passed = clean(b.passed, 10);
      if (!passed || !isDate(passed)) return bad("천사를 만난 날을 골라 주세요");
      if (passed > kstDay()) return bad("천사를 만난 날은 오늘보다 앞이어야 해요");
      if (pet.birth && passed < pet.birth) return bad("천사를 만난 날이 태어난 날보다 앞설 수 없어요");
      const to = dayOf(passed);
      const target = HALLS.find((h) => h.id === to)!;
      const taken = takenFor(to);
      if (taken.size >= TOTAL) return json({ error: `${target.name}의 천사 곁은 이미 가득 찼어요`, full: true, day: target.name }, 409);
      let seat = Number(b.seat);
      if (!Number.isInteger(seat) || seat < 1 || seat > TOTAL || taken.has(seat)) { seat = 1; while (taken.has(seat)) seat++; }
      const r: Reservation = {
        id: nextId("R"), at: new Date().toISOString(), hall: to, seats: [seat], pet: pet.name, kind: pet.kind, petStatus: "먼저 떠났어요",
        owner: a.owner, phone: a.phone, source: "member", status: "active", accountId: a.id, petId: pet.id,
      };
      s.reservations.unshift(r);
      Object.assign(pet, { hall: to, seats: [seat], passed, petStatus: "먼저 떠났어요", dayLocked: true });
      await save();
      return json({ pet: petView(pet) });
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
    // 꽃·촛불은 천사를 만난 아이에게만
    if (req.method === "POST" && m[2] && pet.petStatus !== "먼저 떠났어요") return bad("곁에 있는 아이에게는 꽃 대신 응원의 한 마디를 남겨 주세요");
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
      .filter((p) => p.photoV && p.showInPlaza !== false && p.petStatus === "먼저 떠났어요")
      .sort((a, b) => (b.lastActive || b.at).localeCompare(a.lastActive || a.at))
      .slice(0, 12)
      .map((p) => ({ id: p.id, name: p.name, kind: p.breed || p.kind, hallName: HALLS.find((h) => h.id === p.hall)?.name || "", photo: `/photo/${p.id}.jpg?v=${p.photoV}`, note: notes(p) }));
    return json(list);
  }

  // 양도 요청: 로그인한 회원이, 회원인 받는 분에게, 동의와 비밀번호 확인 후 요청한다
  if (req.method === "POST" && path === "/api/transfer") {
    const b = await body(req);
    const a = accountOf(req);
    if (!a) return bad("로그인한 보호자만 양도할 수 있어요", 401);
    if (a.deleteAt) return bad("탈퇴 신청 중에는 양도할 수 없어요");
    const pet = s.pets.find((p) => p.accountId === a.id && p.id === b.petId);
    const seat = Number(b.seat);
    if (!pet || !pet.seats.includes(seat)) return bad("양도할 자리를 다시 골라 주세요");
    const toPhone = digits(b.toPhone);
    if (!isPhone(toPhone)) return bad("휴대폰 번호 10~11자리를 확인해 주세요");
    if (toPhone === a.phone) return bad("본인에게는 양도할 수 없어요");
    const to = s.accounts.find((x) => x.phone === toPhone && !x.deleteAt);
    if (!to) return bad("받는 분이 먼저 기억의 집 회원이어야 해요. 가입한 휴대폰 번호를 확인해 주세요");
    if (b.agree !== true) return bad("양도하면 이 자리의 메모리얼이 사라진다는 데 동의해 주세요");
    if (!(await Bun.password.verify(String(b.password ?? ""), a.pwHash))) return bad("비밀번호가 맞지 않아요");
    if (s.transfers.some((t) => t.status === "pending" && t.petId === pet.id && t.seat === seat)) return bad("이 자리는 이미 양도를 요청했어요");
    const hallName = HALLS.find((h) => h.id === pet.hall)?.name || "";
    const t: Transfer = {
      id: nextId("T"), at: new Date().toISOString(), seatLabel: `${hallName} #${String(seat).padStart(4, "0")}`, fromName: a.owner, toPhone, status: "pending",
      accountId: a.id, petId: pet.id, hall: pet.hall, seat, toAccountId: to.id, consentAt: new Date().toISOString(),
    };
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
        halls: HALLS.map(hallSummary),
        reservations: s.reservations, transfers: s.transfers,
        guestbook: s.guestbook.map((g) => ({ ...g, pet: g.pet.startsWith("P-") ? petName(g.pet) : g.pet })),
        pets: s.pets.map(petView), accounts: s.accounts.length,
        members: s.accounts.map((a) => ({ id: a.id, at: a.at, owner: a.owner, phone: a.phone, agreedAt: a.agreedAt || "", deleteAt: a.deleteAt || "", pets: s.pets.filter((p) => p.accountId === a.id).map((p) => ({ id: p.id, name: p.name, hallName: HALLS.find((h) => h.id === p.hall)?.name || "", seats: p.seats, deleteAt: p.deleteAt || "", deleteReason: p.deleteReason || "", lover: p.petStatus !== "먼저 떠났어요" })) })),
        graceDays: Math.round(GRACE_MS / 864e5),
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
      const b = await body(req);
      if (b.action === "revert") {
        if (t.status !== "approved" || !t.accountId) return bad("되돌릴 수 있는 양도가 아니에요", 409);
        if (t.deleteAt && t.deleteAt <= new Date().toISOString()) return bad("30일 보관 기간이 지나 되돌릴 수 없어요", 409);
        const err = revertTransfer(t);
        if (err) return bad(err, 409);
        t.status = "reverted";
        t.decidedAt = new Date().toISOString();
        await save();
        return json({ transfer: t });
      }
      if (t.status !== "pending") return bad("이미 처리된 요청이에요", 409);
      if (b.action === "approve" && t.accountId) {
        const err = await approveTransfer(t);
        if (err) return bad(err, 409);
      }
      t.status = b.action === "approve" ? "approved" : "rejected";
      t.decidedAt = new Date().toISOString();
      await save();
      return json({ transfer: t });
    }
    if (req.method === "POST" && path === "/api/admin/purge") return json(await purge());
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
        if (limited(ip, Number(Bun.env.RATE_LIMIT) || 40) || (path === "/api/login" && limited("login:" + ip, 10))) return bad("요청이 너무 많아요. 잠시 후 다시 시도해 주세요", 429);
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

purge().catch(() => {});
console.log(`기억의 집 서버 시작 · 포트 ${server.port} · 데이터 저장소: ${storage.kind}${Bun.env.ADMIN_CODE ? "" : " · 경고: ADMIN_CODE 없음(관리자 페이지 잠김)"}`);
