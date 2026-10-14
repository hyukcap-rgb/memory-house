// 메모리얼 정의와 예시 데이터.
export const TOTAL = 1004; // 메모리얼마다 1004자리, 증설 없음

export type Hall = { id: string; name: string; desc: string; layout: string[]; baseLeft: number; seed: number };

// layout: 회원 화면 '창가 줄'(1~30번 자리) 배치. t=예약됨 f=빈 자리 w=빈 창가 자리 M=보리 자리
export const HALLS: Hall[] = [
  { id: "sun", name: "햇살관", desc: "남향 창가", layout: ["ttfttf", "wttfww", "twMttw", "tffttt", "fttftt"], baseLeft: 12, seed: 11 },
  { id: "star", name: "별빛관", desc: "밤하늘 천장", layout: ["ftfttf", "tffwtf", "ftfftt", "ttftff", "fftftf"], baseLeft: 236, seed: 23 },
  { id: "spring", name: "봄빛관", desc: "정원 회랑", layout: ["fftfff", "tfffwf", "fftfft", "tffftf", "ffftff"], baseLeft: 340, seed: 37 },
];

export type Reservation = {
  id: string; at: string; hall: string; seats: number[]; seatLabel?: string;
  pet: string; kind: string; petStatus: string; owner: string; phone: string;
  source: "guest" | "member" | "seed"; status: "active" | "cancelled";
};
export type Transfer = { id: string; at: string; seatLabel: string; fromName: string; toPhone: string; status: "pending" | "approved" | "rejected"; decidedAt?: string };
export type Guest = { id: string; at: string; pet: string; who: string; text: string; hidden: boolean; reports: number };
export type State = { reservations: Reservation[]; transfers: Transfer[]; guestbook: Guest[]; seq: number };

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

// 시제품용 기본 채움: 1~30번은 layout을 따르고 나머지는 시드로 고정 배치
function baseTaken(h: Hall): Set<number> {
  const taken = new Set<number>();
  let freeInLayout = 0;
  h.layout.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const n = r * 6 + c + 1;
      if (ch === "t" || ch === "M") taken.add(n);
      else freeInLayout++;
    }),
  );
  const restFree = Math.max(0, h.baseLeft - freeInLayout);
  const rest: number[] = [];
  for (let n = 31; n <= TOTAL; n++) rest.push(n);
  const rand = rng(h.seed);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  rest.slice(restFree).forEach((n) => taken.add(n));
  return taken;
}
export const BASE: Record<string, Set<number>> = Object.fromEntries(HALLS.map((h) => [h.id, baseTaken(h)]));

const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
export function seedState(): State {
  return {
    seq: 100,
    reservations: [
      { id: "R-0091", at: ago(52), hall: "sun", seats: [15], seatLabel: "C-3", pet: "보리", kind: "말티즈", petStatus: "먼저 떠났어요", owner: "김지현", phone: "01023457788", source: "seed", status: "active" },
      { id: "R-0092", at: ago(30), hall: "star", seats: [212], pet: "콩이", kind: "비숑", petStatus: "먼저 떠났어요", owner: "이수민", phone: "01088123344", source: "seed", status: "active" },
      { id: "R-0093", at: ago(20), hall: "spring", seats: [87], pet: "나비", kind: "코리안숏헤어", petStatus: "함께 살고 있어요", owner: "박은정", phone: "01077651200", source: "seed", status: "active" },
      { id: "R-0094", at: ago(9), hall: "star", seats: [433, 434], pet: "모모·두리", kind: "포메라니안", petStatus: "함께 살고 있어요", owner: "정해원", phone: "01031119090", source: "seed", status: "active" },
      { id: "R-0095", at: ago(3), hall: "spring", seats: [301], pet: "두부", kind: "말티즈", petStatus: "먼저 떠났어요", owner: "최현우", phone: "01055443322", source: "seed", status: "active" },
    ],
    transfers: [
      { id: "T-0007", at: ago(26), seatLabel: "별빛관 #0518", fromName: "한지민", toPhone: "01064420987", status: "pending" },
      { id: "T-0006", at: ago(120), seatLabel: "봄빛관 #0140", fromName: "오세훈", toPhone: "01020203030", status: "approved", decidedAt: ago(100) },
    ],
    guestbook: [
      { id: "G-0003", at: ago(5), pet: "보리", who: "지수", text: "보리야 오늘 시험 잘 봤어. 네 덕분이야. 보고 싶어.", hidden: false, reports: 0 },
      { id: "G-0002", at: ago(40), pet: "보리", who: "보리 친구 엄마", text: "산책길에서 늘 먼저 꼬리 흔들어주던 보리, 고마웠어.", hidden: false, reports: 0 },
      { id: "G-0001", at: ago(60), pet: "콩이", who: "익명", text: "이런 데 돈 쓰는 사람들 이해가 안 감", hidden: false, reports: 3 },
    ],
  };
}
