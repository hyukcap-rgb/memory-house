// 기억의 집 서버: 화면(public/)과 API를 함께 제공한다.
import { timingSafeEqual } from "node:crypto";
import { join, normalize } from "node:path";
import { BASE, HALLS, TOTAL, seedState, type Guest, type Hall, type Reservation, type State, type Transfer } from "./seed";
import { createStorage } from "./storage";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const STATE_KEY = "data/state.json";
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
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);
async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}
const clean = (v: unknown, max = 60) => String(v ?? "").trim().slice(0, max);
const digits = (v: unknown) => clean(v, 20).replace(/\D/g, "");
const isPhone = (d: string) => /^01\d{8,9}$/.test(d);

function isAdmin(req: Request) {
  const want = Bun.env.ADMIN_CODE;
  const got = req.headers.get("x-admin-code") || "";
  if (!want) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 쓰기 요청 남용 막기: IP당 1분에 40회
const hits = new Map<string, { n: number; t: number }>();
function limited(req: Request, server: { requestIP(r: Request): { address: string } | null }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || server.requestIP(req)?.address || "?";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  if (hits.size > 5000) hits.clear();
  return h.n > 40;
}

// ---------- pages & static ----------
const PAGES: Record<string, string> = { "/": "guest.html", "/start": "index.html", "/guest": "guest.html", "/member": "member.html", "/admin": "admin.html" };
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

  if (req.method === "POST" && path === "/api/reserve") {
    const b = await body(req);
    const h = HALLS.find((x) => x.id === b.hall);
    if (!h) return bad("메모리얼을 다시 골라 주세요");
    const seats: number[] = Array.isArray(b.seats) ? [...new Set<number>(b.seats.map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= TOTAL) : [];
    if (!seats.length || seats.length > 2) return bad("자리를 한두 곳 골라 주세요");
    if (seats.some((n) => takenFor(h.id).has(n))) return bad("방금 다른 분이 고른 자리예요. 다른 자리를 골라 주세요", 409);
    const pet = clean(b.pet, 20), owner = clean(b.owner, 20), phone = digits(b.phone);
    if (!pet || !owner) return bad("아이 이름과 보호자 이름을 적어 주세요");
    if (!isPhone(phone)) return bad("휴대폰 번호 10~11자리를 확인해 주세요");
    const r: Reservation = {
      id: nextId("R"), at: new Date().toISOString(), hall: h.id, seats, seatLabel: clean(b.seatLabel, 20) || undefined,
      pet, kind: clean(b.kind, 20) || "-", petStatus: clean(b.petStatus, 20) || "-", owner, phone,
      source: b.source === "member" ? "member" : "guest", status: "active",
    };
    s.reservations.unshift(r);
    await save();
    return json({ reservation: { id: r.id, hall: r.hall, seats: r.seats }, hall: hallSummary(h) });
  }

  if (req.method === "POST" && path === "/api/transfer") {
    const b = await body(req);
    const toPhone = digits(b.toPhone);
    if (!isPhone(toPhone)) return bad("휴대폰 번호 10~11자리를 확인해 주세요");
    const t: Transfer = { id: nextId("T"), at: new Date().toISOString(), seatLabel: clean(b.seatLabel, 30) || "-", fromName: clean(b.fromName, 20) || "-", toPhone, status: "pending" };
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
    await save();
    return json({ entry: { id: g.id, at: g.at, pet: g.pet, who: g.who, text: g.text } });
  }

  // ---- admin ----
  if (path.startsWith("/api/admin/")) {
    if (!Bun.env.ADMIN_CODE) return bad("관리자 코드가 설정되지 않았어요. 서버의 ADMIN_CODE를 확인해 주세요", 503);
    if (!isAdmin(req)) return bad("관리자 코드를 확인해 주세요", 401);

    if (req.method === "GET" && path === "/api/admin/overview") {
      return json({ halls: HALLS.map((h) => ({ ...hallSummary(h), takenSeats: [...takenFor(h.id)] })), reservations: s.reservations, transfers: s.transfers, guestbook: s.guestbook });
    }
    if (req.method === "POST" && path === "/api/admin/reset") {
      state = seedState();
      await save();
      return json({ ok: true });
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
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/healthz") return new Response("ok");
    if (path.startsWith("/api/")) {
      if (req.method !== "GET" && limited(req, srv)) return bad("요청이 너무 많아요. 잠시 후 다시 시도해 주세요", 429);
      try {
        return await api(req, url, path);
      } catch (e) {
        console.error("API 오류", path, e);
        return bad("잠시 후 다시 시도해 주세요", 500);
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("허용되지 않는 요청이에요", { status: 405 });
    return (await serveStatic(path)) ?? new Response("페이지를 찾을 수 없어요", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
});

console.log(`기억의 집 서버 시작 · 포트 ${server.port} · 데이터 저장소: ${storage.kind}${Bun.env.ADMIN_CODE ? "" : " · 경고: ADMIN_CODE 없음(관리자 페이지 잠김)"}`);
