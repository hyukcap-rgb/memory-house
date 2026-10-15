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
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_CODE: CODE, S3_ENDPOINT: "", GRACE_MS: "1500", RATE_LIMIT: "1000" },
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

  test("366일, 날마다 1004자리", async () => {
    const halls = await (await fetch(BASE + "/api/halls")).json();
    expect(halls.length).toBe(366);
    expect(halls.every((h: any) => h.total === 1004)).toBe(true);
    expect(halls.find((h: any) => h.id === "02-29").name).toBe("2월 29일");
  });

  test("그날의 1004자리가 다 차면 들어갈 수 없음", async () => {
    const full = await (await fetch(BASE + "/api/halls/12-25/seats")).json();
    expect(full.left).toBe(0);
    const r = await post("/api/reserve", { hall: "12-25", seats: [1], pet: "눈", petStatus: "먼저 떠났어요", passed: "2025-12-25", owner: "a", phone: "01044443333", password: "secret12", agree: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("12월 25일의 천사 곁은 이미 가득 찼어요");
  });

  test("먼저 떠난 아이는 천사를 만난 날에만", async () => {
    const { seat } = await freeSeat("06-15");
    const base = { hall: "06-15", seats: [seat], pet: "솜", petStatus: "먼저 떠났어요", owner: "a", phone: "01044442222", password: "secret12", agree: true };
    expect((await post("/api/reserve", base)).status).toBe(400); // 날짜 없음
    expect((await post("/api/reserve", { ...base, passed: "2025-06-16" })).status).toBe(400); // 날짜 다름
  });

  test("비회원 예약 → 계정 생성·로그인 쿠키, 같은 자리 재예약 불가", async () => {
    const { seat, left } = await freeSeat("08-20");
    const body = { hall: "08-20", seats: [seat], pet: "하늘", kind: "강아지", petStatus: "먼저 떠났어요", passed: "2026-08-20", owner: "테스트", phone: "010-1234-5678", password: "secret12", agree: true, source: "guest" };
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
    const { seat } = await freeSeat("07-01");
    const base = { hall: "07-01", seats: [seat], pet: "a", owner: "b", phone: "01055556666" };
    expect((await post("/api/reserve", base)).status).toBe(400);
    expect((await post("/api/reserve", { ...base, password: "123", agree: true })).status).toBe(400);
    expect((await post("/api/reserve", { ...base, password: "secret12" })).status).toBe(400); // 동의 없음
    expect((await post("/api/reserve", { ...base, phone: "01012345678", password: "wrongpass" })).status).toBe(409);
  });

  test("아이 정보 입력·사진 저장", async () => {
    const put = (path: string, data: unknown) => fetch(BASE + path, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(data) });
    const r = await put(`/api/me/pets/${petId}`, { nickname: "하늘이", birth: "2014-05-01", passed: "2026-08-20", weight: "4.5", likes: "공놀이", tags: ["순둥이", "먹보", "겁쟁이", "넷째"] });
    expect(r.status).toBe(200);
    const pet = (await r.json()).pet;
    expect(pet.weight).toBe("4.5");
    expect(pet.tags).toEqual(["순둥이", "먹보", "겁쟁이"]);
    expect((await put(`/api/me/pets/${petId}`, { birth: "2020-01-01", passed: "2019-01-01" })).status).toBe(400);
    expect((await put(`/api/me/pets/${petId}`, { passed: "2026-08-21" })).status).toBe(400); // 메모리얼 날짜와 다름
    expect((await (await fetch(BASE + "/api/me", { headers: { cookie } })).json()).pets[0].birth).toBe("2014-05-01"); // 실패한 수정은 반영 안 됨
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
    expect((await post("/api/reserve", { hall: "08-20", seats: [5000], pet: "a", owner: "b", phone: "01012345678", password: "secret12" })).status).toBe(400);
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

  test("방명록 숨기기", async () => {
    const h = { "x-admin-code": CODE };
    const g = await (await post("/api/guestbook", { pet: "보리", who: "나", text: "보고 싶어" })).json();
    await post(`/api/admin/guestbook/${g.entry.id}`, { hidden: true }, h);
    const list = await (await fetch(BASE + "/api/guestbook?pet=" + encodeURIComponent("보리"))).json();
    expect(list.find((x: any) => x.id === g.entry.id)).toBeUndefined();
  });
});

describe("양도·탈퇴와 30일 보관 후 삭제", () => {
  const h = { "x-admin-code": CODE };
  const signup = async (phone: string, pet: string) => {
    const d = await (await fetch(`${BASE}/api/halls/04-10/seats`)).json();
    const taken = new Set(d.taken); let n = 1; while (taken.has(n)) n++;
    const r = await post("/api/reserve", { hall: "04-10", seats: [n], pet, kind: "고양이", petStatus: "함께 살고 있어요", owner: pet + "보호자", phone, password: "pass1234", agree: true });
    expect(r.status).toBe(200);
    const body = await r.json();
    return { cookie: (r.headers.get("set-cookie") || "").split(";")[0], pet: body.pet, seat: n };
  };
  const as = (cookie: string) => (path: string, data: unknown) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(data) });

  test("받는 분이 회원이 아니면 양도 불가, 동의·비밀번호 필수", async () => {
    const A = await signup("01030000001", "나리");
    const send = as(A.cookie);
    const base = { petId: A.pet.id, seat: A.seat, password: "pass1234", agree: true };
    expect((await send("/api/transfer", { ...base, toPhone: "01099990000" })).status).toBe(400);
    const B = await signup("01030000002", "구름");
    expect((await send("/api/transfer", { ...base, toPhone: "01030000002", agree: false })).status).toBe(400);
    expect((await send("/api/transfer", { ...base, toPhone: "01030000002", password: "wrong" })).status).toBe(400);
    expect((await fetch(BASE + "/api/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, toPhone: "01030000002" }) })).status).toBe(401);
    const ok = await send("/api/transfer", { ...base, toPhone: "01030000002" });
    expect(ok.status).toBe(200);
    const tid = (await ok.json()).transfer.id;

    // 승인 → 자리가 받는 분에게, 보내는 분 메모리얼은 삭제 예정
    const ap = await post(`/api/admin/transfers/${tid}`, { action: "approve" }, h);
    expect(ap.status).toBe(200);
    const meB = await (await fetch(BASE + "/api/me", { headers: { cookie: B.cookie } })).json();
    expect(meB.pets.some((p: any) => p.seats.includes(A.seat))).toBe(true);
    const meA = await (await fetch(BASE + "/api/me", { headers: { cookie: A.cookie } })).json();
    expect(meA.pets[0].seats.length).toBe(0);
    expect(meA.pets[0].deleteAt).toBeTruthy();

    // 30일 안에는 되돌리기 가능
    expect((await post(`/api/admin/transfers/${tid}`, { action: "revert" }, h)).status).toBe(200);
    const meA2 = await (await fetch(BASE + "/api/me", { headers: { cookie: A.cookie } })).json();
    expect(meA2.pets[0].seats).toEqual([A.seat]);
    expect(meA2.pets[0].deleteAt).toBeFalsy();

    // 다시 양도·승인 후 보관 기간이 지나면 보내는 분 메모리얼이 사라짐
    const t2 = await (await send("/api/transfer", { ...base, toPhone: "01030000002" })).json();
    await post(`/api/admin/transfers/${t2.transfer.id}`, { action: "approve" }, h);
    await Bun.sleep(1700);
    await post("/api/admin/purge", {}, h);
    expect((await fetch(`${BASE}/api/pets/${A.pet.id}`)).status).toBe(404);
    expect((await post(`/api/admin/transfers/${t2.transfer.id}`, { action: "revert" }, h)).status).toBe(409);
  });

  test("탈퇴: 동의 필수, 기간 안 취소 가능, 지나면 계정·메모리얼 삭제", async () => {
    const C = await signup("01030000003", "별이");
    const send = as(C.cookie);
    expect((await send("/api/me/withdraw", { password: "pass1234" })).status).toBe(400);
    expect((await send("/api/me/withdraw", { password: "pass1234", agree: true })).status).toBe(200);
    expect((await send("/api/me/withdraw/cancel", {})).status).toBe(200);
    const me = await (await fetch(BASE + "/api/me", { headers: { cookie: C.cookie } })).json();
    expect(me.account.deleteAt).toBeFalsy();
    expect(me.pets[0].deleteAt).toBeFalsy();

    await send("/api/me/withdraw", { password: "pass1234", agree: true });
    const seatsBefore = await (await fetch(`${BASE}/api/halls/04-10/seats`)).json();
    await Bun.sleep(1700);
    await post("/api/admin/purge", {}, h);
    expect((await post("/api/login", { phone: "01030000003", password: "pass1234" })).status).toBe(401);
    expect((await fetch(`${BASE}/api/pets/${C.pet.id}`)).status).toBe(404);
    const seatsAfter = await (await fetch(`${BASE}/api/halls/04-10/seats`)).json();
    expect(seatsAfter.left).toBe(seatsBefore.left + 1); // 자리가 다시 비었음
  });
});

describe("미리 들어온 아이의 날짜 변경 (한 번)", () => {
  const signup = async (phone: string, pet: string, hall = "04-11") => {
    const d = await (await fetch(`${BASE}/api/halls/${hall}/seats`)).json();
    const taken = new Set(d.taken); let n = 1; while (taken.has(n)) n++;
    const r = await post("/api/reserve", { hall, seats: [n], pet, kind: "강아지", petStatus: "함께 살고 있어요", owner: pet + "보호자", phone, password: "pass1234", agree: true });
    expect(r.status).toBe(200);
    const body = await r.json();
    return { cookie: (r.headers.get("set-cookie") || "").split(";")[0], pet: body.pet, seat: n };
  };
  const as = (cookie: string) => (path: string, data: unknown, method = "POST") => fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(data) });

  test("정보 고치기로는 떠났다고 바꿀 수 없음", async () => {
    const A = await signup("01040000001", "구름");
    expect((await as(A.cookie)(`/api/me/pets/${A.pet.id}`, { petStatus: "먼저 떠났어요", passed: "2025-06-01" }, "PUT")).status).toBe(400);
  });

  test("가득 찬 날로는 못 옮기고, 빈 날로는 한 번만 옮김", async () => {
    const A = await signup("01040000002", "달이");
    const send = as(A.cookie);
    const full = await send(`/api/me/pets/${A.pet.id}/angel-day`, { passed: "2025-12-25" });
    expect(full.status).toBe(409);
    expect((await full.json()).full).toBe(true);
    const before = await (await fetch(`${BASE}/api/halls/06-03/seats`)).json();
    const ok = await send(`/api/me/pets/${A.pet.id}/angel-day`, { passed: "2025-06-03" });
    expect(ok.status).toBe(200);
    const d = await ok.json();
    expect(d.moved).toBe(true);
    expect(d.pet.hall).toBe("06-03");
    expect(d.pet.dayLocked).toBe(true);
    expect(d.pet.petStatus).toBe("먼저 떠났어요");
    const after = await (await fetch(`${BASE}/api/halls/06-03/seats`)).json();
    expect(after.left).toBe(before.left - 1);
    const old = await (await fetch(`${BASE}/api/halls/04-11/seats`)).json();
    expect(old.taken).not.toContain(A.seat);
    expect((await send(`/api/me/pets/${A.pet.id}/angel-day`, { passed: "2025-06-04" })).status).toBe(409);
    expect((await send(`/api/me/pets/${A.pet.id}`, { passed: "2025-06-04" }, "PUT")).status).toBe(400);
    expect((await send(`/api/me/pets/${A.pet.id}`, { weight: "4.1" }, "PUT")).status).toBe(200);
  });

  test("가득 찬 날이면 처음 날에 그대로 남기", async () => {
    const A = await signup("01040000003", "솜이");
    const r = await as(A.cookie)(`/api/me/pets/${A.pet.id}/angel-day`, { passed: "2025-12-25", keep: true });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.pet.hall).toBe("04-11");
    expect(d.pet.dayChange.kept).toBe(true);
  });

  test("미래 날짜 불가", async () => {
    const A = await signup("01040000004", "하늘");
    expect((await as(A.cookie)(`/api/me/pets/${A.pet.id}/angel-day`, { passed: "2099-01-01" })).status).toBe(400);
  });
});
