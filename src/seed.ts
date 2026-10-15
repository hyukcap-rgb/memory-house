// 메모리얼 정의와 예시 데이터.
export const TOTAL = 1004; // 메모리얼마다 1004자리, 증설 없음

// 메모리얼은 '아이가 천사를 만난 날'이다. 1년 366일(2월 29일 포함) 하루하루가 각각 1004자리.
// 그날의 1004자리가 다 차면, 다른 날이 비어 있어도 그날의 아이는 더 들어갈 수 없다.
export type Hall = { id: string; name: string; desc: string };
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const HALLS: Hall[] = MONTH_DAYS.flatMap((n, mi) =>
  Array.from({ length: n }, (_, di) => {
    const id = `${String(mi + 1).padStart(2, "0")}-${String(di + 1).padStart(2, "0")}`;
    return { id, name: `${mi + 1}월 ${di + 1}일`, desc: "" };
  }),
);
export const dayOf = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : "");

export type Reservation = {
  id: string; at: string; hall: string; seats: number[]; seatLabel?: string;
  pet: string; kind: string; petStatus: string; owner: string; phone: string;
  source: "guest" | "member" | "seed"; status: "active" | "cancelled";
  accountId?: string; petId?: string;
};
// 회원 계정: 휴대폰 번호 + 비밀번호
export type Account = { id: string; at: string; owner: string; phone: string; pwHash: string; agreedAt?: string; deleteAt?: string; withdrawConsentAt?: string };
// 아이 정보: 회원 화면에 보이는 내용
export type Pet = {
  id: string; accountId: string; at: string; name: string; kind: string; breed: string; petStatus: string;
  nickname: string; birth: string; passed: string; weight: string; likes: string; tags: string[];
  photoV: number; hall: string; seats: number[];
  deleteAt?: string; deleteReason?: "withdraw" | "transfer";
  dayLocked?: boolean;
  showInPlaza?: boolean; flowerDay?: string; flowersToday?: number; flowersTotal?: number; candleUntil?: number; lastActive?: string;
};
export type FeedItem = { id: string; at: string; petId: string; who: string; text: string; photoV: number };
export type Session = { accountId: string; exp: number };
export type Transfer = { id: string; at: string; seatLabel: string; fromName: string; toPhone: string; status: "pending" | "approved" | "rejected" | "cancelled" | "reverted"; decidedAt?: string; accountId?: string; petId?: string;
  hall?: string; seat?: number; toAccountId?: string; toPetId?: string; consentAt?: string; deleteAt?: string; reservationId?: string };
export type Guest = { id: string; at: string; pet: string; who: string; text: string; hidden: boolean; reports: number };
export type State = {
  reservations: Reservation[]; transfers: Transfer[]; guestbook: Guest[]; seq: number;
  accounts: Account[]; pets: Pet[]; feed: FeedItem[]; sessions: Record<string, Session>;
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 시제품용 기본 채움(날짜마다 고정된 무작위). 가득 찬 날과 거의 찬 날을 일부 둔다.
const FULL_DAYS = new Set(["01-01", "02-14", "12-25"]);
const NEAR_FULL: Record<string, number> = { "09-21": 12, "05-05": 7, "10-09": 21 };
// 예시 예약 자리는 기본 채움에 반드시 들어가 있어야 한다
const SEED_SEATS: Record<string, number[]> = { "09-21": [15], "03-14": [212], "07-07": [87], "11-02": [433, 434], "05-20": [301] };
const baseCache = new Map<string, Set<number>>();
export function baseOf(day: string): Set<number> {
  const hit = baseCache.get(day);
  if (hit) return hit;
  const idx = HALLS.findIndex((h) => h.id === day);
  const rand = rng(1000 + idx * 7919);
  const left = FULL_DAYS.has(day) ? 0 : NEAR_FULL[day] ?? (day === "02-29" ? 900 : Math.round(30 + rand() * 640));
  const all: number[] = [];
  for (let n = 1; n <= TOTAL; n++) all.push(n);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const taken = new Set(all.slice(left));
  for (const n of SEED_SEATS[day] || []) if (!taken.has(n)) { taken.add(n); const free = all.slice(0, left).find((x) => !taken.has(x) && !(SEED_SEATS[day] || []).includes(x)); if (free) taken.delete(free); }
  baseCache.set(day, taken);
  return taken;
}

const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
export function seedState(): State {
  return {
    seq: 100,
    accounts: [], pets: [], feed: [], sessions: {},
    reservations: [
      { id: "R-0091", at: ago(52), hall: "09-21", seats: [15], pet: "보리", kind: "말티즈", petStatus: "먼저 떠났어요", owner: "김지현", phone: "01023457788", source: "seed", status: "active" },
      { id: "R-0092", at: ago(30), hall: "03-14", seats: [212], pet: "콩이", kind: "비숑", petStatus: "먼저 떠났어요", owner: "이수민", phone: "01088123344", source: "seed", status: "active" },
      { id: "R-0093", at: ago(20), hall: "07-07", seats: [87], pet: "나비", kind: "코리안숏헤어", petStatus: "먼저 떠났어요", owner: "박은정", phone: "01077651200", source: "seed", status: "active" },
      { id: "R-0094", at: ago(9), hall: "11-02", seats: [433, 434], pet: "모모·두리", kind: "포메라니안", petStatus: "먼저 떠났어요", owner: "정해원", phone: "01031119090", source: "seed", status: "active" },
      { id: "R-0095", at: ago(3), hall: "05-20", seats: [301], pet: "두부", kind: "말티즈", petStatus: "먼저 떠났어요", owner: "최현우", phone: "01055443322", source: "seed", status: "active" },
    ],
    transfers: [
      { id: "T-0007", at: ago(26), seatLabel: "3월 14일 #0518", fromName: "한지민", toPhone: "01064420987", status: "pending" },
      { id: "T-0006", at: ago(120), seatLabel: "7월 7일 #0140", fromName: "오세훈", toPhone: "01020203030", status: "approved", decidedAt: ago(100) },
    ],
    guestbook: [
      { id: "G-0003", at: ago(5), pet: "보리", who: "지수", text: "보리야 오늘 시험 잘 봤어. 네 덕분이야. 보고 싶어.", hidden: false, reports: 0 },
      { id: "G-0002", at: ago(40), pet: "보리", who: "보리 친구 엄마", text: "산책길에서 늘 먼저 꼬리 흔들어주던 보리, 고마웠어.", hidden: false, reports: 0 },
      { id: "G-0001", at: ago(60), pet: "콩이", who: "익명", text: "이런 데 돈 쓰는 사람들 이해가 안 감", hidden: false, reports: 3 },
    ],
  };
}
