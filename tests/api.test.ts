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
  for (const p of ["/", "/guest", "/member", "/admin", "/static/angel.js", "/img/p1.jpg"]) {
    test(`${p} 열림`, async () => expect((await fetch(BASE + p)).status).toBe(200));
  }
  test("없는 경로·상위 폴더 접근은 404", async () => {
    expect((await fetch(BASE + "/nope")).status).toBe(404);
    expect((await fetch(BASE + "/static/..%2F..%2Fpackage.json")).status).toBe(404);
  });
});

describe("예약", () => {
  test("메모리얼마다 1004자리", async () => {
    const halls = await (await fetch(BASE + "/api/halls")).json();
    expect(halls.map((h: any) => h.total)).toEqual([1004, 1004, 1004]);
  });

  test("빈 자리 예약 → 남은 자리 감소, 같은 자리는 다시 못 잡음", async () => {
    const before = await (await fetch(BASE + "/api/halls/star/seats")).json();
    const taken = new Set(before.taken);
    let seat = 1; while (taken.has(seat)) seat++;
    const body = { hall: "star", seats: [seat], pet: "하늘", owner: "테스트", phone: "010-1234-5678", source: "guest" };
    const ok = await post("/api/reserve", body);
    expect(ok.status).toBe(200);
    expect((await ok.json()).hall.left).toBe(before.left - 1);
    expect((await post("/api/reserve", body)).status).toBe(409);
  });

  test("잘못된 입력은 막음", async () => {
    expect((await post("/api/reserve", { hall: "star", seats: [5000], pet: "a", owner: "b", phone: "01012345678" })).status).toBe(400);
    expect((await post("/api/reserve", { hall: "star", seats: [3], pet: "", owner: "b", phone: "01012345678" })).status).toBe(400);
    expect((await post("/api/reserve", { hall: "star", seats: [3], pet: "a", owner: "b", phone: "123" })).status).toBe(400);
    expect((await post("/api/guestbook", { text: "  " })).status).toBe(400);
  });
});

describe("관리자", () => {
  test("코드 없으면 401", async () => {
    expect((await fetch(BASE + "/api/admin/overview")).status).toBe(401);
    expect((await fetch(BASE + "/api/admin/overview", { headers: { "x-admin-code": "wrong" } })).status).toBe(401);
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
