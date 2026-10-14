import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const CODE = "test-code";
const dir = mkdtempSync(join(tmpdir(), "memory-house-"));
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "run", "src/server.ts"], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_CODE: CODE, S3_ENDPOINT: "" },
    stdout: "ignore", stderr: "inherit",
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + "/healthz")).ok) return; } catch {}
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
});
afterAll(() => { proc.kill(); rmSync(dir, { recursive: true, force: true }); });

const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
  fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });

describe("화면", () => {
  for (const p of ["/", "/start", "/guest", "/member", "/admin", "/static/angel.js", "/img/p1.jpg"]) {
    test(`${p} 열림`, async () => expect((await fetch(BASE + p)).status).toBe(200));
  }
  test("없는 경로·상위 폴더 접근은 404", async () => {
    expect((await fetch(BASE + "/nope")).status).toBe(404);
    expect((await fetch(BASE + "/static/..%2F..%2Fpackage.json")).status).toBe(404);
  });
});

describe("예약·계정·아이 정보", () => {
  let cookie = "";
  let petId = "";
  const freeSeat = async (hall: string) => {
    const d = await (await fetch(`${BASE}/api/halls/${hall}/seats`)).json();
    const taken = new Set(d.taken); let n = 1; while (taken.has(n)) n++; return { seat: n, left: d.left };
  };

  test("메모리얼마다 1004자리", async () => {
    const halls = await (await fetch(BASE + "/api/halls")).json();
    expect(halls.map((h: any) => h.total)).toEqual([1004, 1004, 1004]);
  });

  test("비회원 예약 → 계정 생성·로그인 쿠키, 같은 자리 재예약 불가", async () => {
    const { seat, left } = await freeSeat("star");
    const body = { hall: "star", seats: [seat], pet: "하늘", kind: "강아지", petStatus: "먼저 떠났어요", owner: "테스트", phone: "010-1234-5678", password: "secret12", agree: true, source: "guest" };
    const res = await post("/api/reserve", body);
    expect(res.status).toBe(200);
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    expect(cookie.startsWith("mh_s=")).toBe(true);
    const d = await res.json();
    petId = d.pet.id;
    expect(d.hall.left).toBe(left - 1);
    expect((await post("/api/reserve", body)).status).toBe(409);
  });

  test("비밀번호 없거나 짧으면 막음, 가입된 번호에 틀린 비밀번호도 막음", async () => {
    const { seat } = await freeSeat("spring");
    const base = { hall: "spring", seats: [seat], pet: "a", owner: "b", phone: "01055556666" };
    expect((await post("/api/reserve", base)).status).toBe(400);
    expect((await post("/api/reserve", { ...base, password: "123", agree: true })).status).toBe(400);
    expect((await post("/api/reserve", { ...base, password: "secret12" })).status).toBe(400); // 동의 없음
    expect((await post("/api/reserve", { ...base, phone: "01012345678", password: "wrongpass" })).status).toBe(409);
  });

  test("아이 정보 입력·사진 저장", async () => {
    const put = (path: string, data: unknown) => fetch(BASE + path, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(data) });
    const r = await put(`/api/me/pets/${petId}`, { nickname: "하늘이", birth: "2014-05-01", passed: "2026-08-30", weight: "4.5", likes: "공놀이", tags: ["순둥이", "먹보", "겁쟁이", "넷째"] });
    expect(r.status).toBe(200);
    const pet = (await r.json()).pet;
    expect(pet.weight).toBe("4.5");
    expect(pet.tags).toEqual(["순둥이", "먹보", "겁쟁이"]);
    expect((await put(`/api/me/pets/${petId}`, { birth: "2020-01-01", passed: "2019-01-01" })).status).toBe(400);
    expect((await put(`/api/me/pets/${petId}`, { weight: "많이" })).status).toBe(400);

    const jpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).toString("base64");
    const ph = await put(`/api/me/pets/${petId}/photo`, { image: jpeg });
    expect(ph.status).toBe(200);
    const url = (await ph.json()).pet.photo;
    expect((await fetch(BASE + url)).status).toBe(200);
    expect((await put(`/api/me/pets/${petId}/photo`, { image: "data:image/png;base64,AAAA" })).status).toBe(400);
  });

  test("내 정보·기록, 로그인 없이는 401", async () => {
    expect((await fetch(BASE + "/api/me")).status).toBe(401);
    const me = await (await fetch(BASE + "/api/me", { headers: { cookie } })).json();
    expect(me.pets[0].name).toBe("하늘");
    expect(me.pets[0].nickname).toBe("하늘이");
    const f = await fetch(`${BASE}/api/me/pets/${petId}/feed`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ text: "보고 싶어" }) });
    expect(f.status).toBe(200);
    const list = await (await fetch(`${BASE}/api/me/pets/${petId}/feed`, { headers: { cookie } })).json();
    expect(list[0].text).toBe("보고 싶어");
  });

  test("로그아웃 후 다시 로그인", async () => {
    await fetch(BASE + "/api/logout", { method: "POST", headers: { cookie } });
    expect((await fetch(BASE + "/api/me", { headers: { cookie } })).status).toBe(401);
    expect((await post("/api/login", { phone: "01012345678", password: "nope1234" })).status).toBe(401);
    const ok = await post("/api/login", { phone: "010-1234-5678", password: "secret12" });
    expect(ok.status).toBe(200);
    const c2 = (ok.headers.get("set-cookie") || "").split(";")[0];
    expect((await fetch(BASE + "/api/me", { headers: { cookie: c2 } })).status).toBe(200);
  });

  test("공개 메모리얼: 정보 공개 범위, 꽃·촛불, 광장", async () => {
    const pub = await (await fetch(`${BASE}/api/pets/${petId}`)).json();
    expect(pub.name).toBe("하늘");
    expect(pub.phone).toBeUndefined();
    expect(pub.accountId).toBeUndefined();
    const f1 = await (await post(`/api/pets/${petId}/flower`, {})).json();
    const f2 = await (await post(`/api/pets/${petId}/flower`, {})).json();
    expect(f2.flowers.today).toBe(f1.flowers.today + 1);
    expect((await (await post(`/api/pets/${petId}/candle`, { on: true })).json()).candle).toBe(true);
    const plaza = await (await fetch(BASE + "/api/plaza")).json();
    expect(plaza.some((p: any) => p.id === petId)).toBe(true); // 사진 있음 + 기본 공개
    expect((await fetch(`${BASE}/m/${petId}`)).status).toBe(200);
    expect(await (await fetch(`${BASE}/m/${petId}`)).text()).toContain("하늘의 메모리얼");
    expect((await fetch(`${BASE}/m/P-9999`)).status).toBe(404);
  });

  test("비밀번호 바꾸기", async () => {
    const login = await post("/api/login", { phone: "01012345678", password: "secret12" });
    const c = (login.headers.get("set-cookie") || "").split(";")[0];
    const put = (data: unknown) => fetch(BASE + "/api/me/password", { method: "PUT", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify(data) });
    expect((await put({ current: "wrong", next: "newpass1" })).status).toBe(400);
    expect((await put({ current: "secret12", next: "newpass1" })).status).toBe(200);
    expect((await post("/api/login", { phone: "01012345678", password: "newpass1" })).status).toBe(200);
    await put({ current: "newpass1", next: "secret12" });
  });

  test("잘못된 입력은 막음", async () => {
    expect((await post("/api/reserve", { hall: "star", seats: [5000], pet: "a", owner: "b", phone: "01012345678", password: "secret12" })).status).toBe(400);
    expect((await post("/api/guestbook", { text: "  " })).status).toBe(400);
  });
});

describe("관리자", () => {
  test("코드 없으면 401", async () => {
    expect((await fetch(BASE + "/api/admin/overview")).status).toBe(401);
    expect((await fetch(BASE + "/api/admin/overview", { headers: { "x-admin-code": "wrong" } })).status).toBe(401);
  });

  test("임시 비밀번호 발급", async () => {
    const h = { "x-admin-code": CODE };
    const ov = await (await fetch(BASE + "/api/admin/overview", { headers: h })).json();
    const m = ov.members.find((x: any) => x.phone === "01012345678");
    expect(m.pets.length).toBeGreaterThan(0);
    const d = await (await post(`/api/admin/accounts/${m.id}/password`, {}, h)).json();
    expect(d.temp.length).toBe(8);
    expect((await post("/api/login", { phone: "01012345678", password: d.temp })).status).toBe(200);
  });

  test("양도 요청 → 승인, 방명록 숨기기", async () => {
    const t = await (await post("/api/transfer", { seatLabel: "별빛관 A-5", fromName: "김지현", toPhone: "01099998888" })).json();
    const h = { "x-admin-code": CODE };
    const ok = await post(`/api/admin/transfers/${t.transfer.id}`, { action: "approve" }, h);
    expect((await ok.json()).transfer.status).toBe("approved");
    expect((await post(`/api/admin/transfers/${t.transfer.id}`, { action: "approve" }, h)).status).toBe(409);

    const g = await (await post("/api/guestbook", { pet: "보리", who: "나", text: "보고 싶어" })).json();
    await post(`/api/admin/guestbook/${g.entry.id}`, { hidden: true }, h);
    const list = await (await fetch(BASE + "/api/guestbook?pet=" + encodeURIComponent("보리"))).json();
    expect(list.find((x: any) => x.id === g.entry.id)).toBeUndefined();
  });
});
