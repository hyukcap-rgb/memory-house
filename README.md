# 기억의 집

반려동물을 영원히 기억할 수 있는 온라인 메모리얼. 메모리얼마다 1004자리, 다 채워지면 늘리지 않는다.
메모리얼에 들어가면 1004개의 조각이 아이들 사진으로 채워져 하나의 천사(날개와 빛)가 된다.

> 1004의 별이 모여 하나의 빛이 됩니다

## 화면

| 경로 | 화면 | 내용 |
|---|---|---|
| `/`, `/guest` | 비회원 | 메모리얼 둘러보기 → 천사 입장 → 구역(후광 곁·날개·옷자락)에서 자리 고르기 → 예약(계정 만들기) → 아이 소개 입력 |
| `/member` | 회원 | 로그인 후 내 아이의 메모리얼: 입장(아이 정보), 정보 고치기, 피드·기록, 참배(꽃·촛불·방명록), 기억의 방, 기억 보존, 별빛 광장, 자리 양도. `/member?demo`는 예시(보리) |
| `/admin` | 관리자 | 대시보드, 예약 관리(취소·되돌리기), 양도 승인·거절, 방명록 숨기기, 메모리얼별 채움 |
| `/start` | 시연 입구 | 세 화면으로 가는 링크 모음 |

세 화면은 같은 데이터를 쓴다. 비회원 화면에서 예약하면 관리자 화면에 바로 보인다.

## 회원과 아이 정보

- 비회원이 자리를 예약할 때 **휴대폰 번호 + 비밀번호(6자 이상)**로 계정이 만들어지고 바로 로그인된다. 같은 번호로 또 예약하면 그 계정에 아이가 추가된다.
- 예약 직후 **아이 소개** 단계에서 대표 사진, 품종, 별명, 생일, 떠난 날, 몸무게, 좋아한 것, 성격(3개)을 넣는다. 건너뛰고 나중에 회원 화면의 **정보 고치기**에서 넣어도 된다.
- 회원 화면의 입장·홈·참배·기억의 방·보존 화면은 모두 로그인한 아이의 정보로 그려진다.
- 사진은 브라우저에서 줄여(최대 1280px JPEG) 버킷 `photos/`에 저장한다.
- 로그인은 30일 유지되는 HttpOnly 쿠키 세션이다. 비밀번호는 Argon2로 해시해 저장한다.

## 원칙

- 메모리얼마다 **1004자리 고정, 증설 없음**. 자리 번호는 후광(빛)에서 가까운 순서로 1~1004.
- 자리 **매매 메뉴는 없고 양도만** 있다. 조건은 두 보호자가 정하고, 운영자는 승인만 한다.
- 오프라인 시설 연계가 아니라 **온라인에서 영원히 기억하는 곳**.
- 아이를 "마리"로 세지 않는다.

## 구조

```
public/            화면 (HTML 한 장씩, 빌드 없음)
  index.html       시연 입구 (/start)
  guest.html       비회원 화면
  member.html      회원 화면
  admin.html       관리자 페이지
  static/angel.js  1004 조각 천사 그리기 (세 화면 공용)
  img/             사진
src/
  server.ts        화면 + API 서버 (Bun)
  seed.ts          메모리얼 정의, 예시 데이터
  storage.ts       데이터 저장소 (S3 호환 버킷 또는 로컬 폴더)
tests/api.test.ts  API 테스트
```

## 로컬 실행

[Bun](https://bun.sh) 1.1 이상이 필요하다.

```bash
ADMIN_CODE=원하는코드 bun run dev     # http://localhost:3000
bun test                              # 테스트
```

버킷 환경변수가 없으면 데이터는 `./.data/data/state.json`에 저장된다.

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `ADMIN_CODE` | 예 | 관리자 페이지 코드. 없으면 관리자 페이지가 잠긴다 |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | 배포 시 권장 | 데이터를 S3 호환 버킷에 저장 (재배포해도 유지) |
| `S3_REGION` | | 기본 `auto` |
| `DATA_DIR` | | 버킷을 안 쓸 때 저장 폴더. 기본 `./.data` |
| `PORT` | | 기본 3000 |

## 배포 (Railway)

`main` 브랜치에 푸시하면 Railway가 `Dockerfile`로 빌드해 자동 배포한다(`railway.json`).
데이터는 같은 프로젝트의 Railway 버킷에 저장되며, 서비스 변수는 버킷 값을 참조한다.

```
S3_ENDPOINT=${{site.ENDPOINT}}
S3_BUCKET=${{site.BUCKET}}
S3_REGION=${{site.REGION}}
S3_ACCESS_KEY_ID=${{site.ACCESS_KEY_ID}}
S3_SECRET_ACCESS_KEY=${{site.SECRET_ACCESS_KEY}}
```

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/halls` | 메모리얼 목록과 남은 자리 |
| GET | `/api/halls/:id/seats` | 채워진 자리 번호 |
| POST | `/api/reserve` | 자리 예약 + 계정 생성 `{hall, seats, pet, kind, petStatus, owner, phone, password}` |
| POST | `/api/login`, `/api/logout` | 로그인·로그아웃 `{phone, password}` |
| GET | `/api/me` | 내 계정과 아이 목록 |
| PUT | `/api/me/pets/:id` | 아이 정보 고치기 `{name, breed, nickname, birth, passed, weight, likes, tags}` |
| PUT | `/api/me/pets/:id/photo` | 대표 사진 `{image: dataURL(JPEG)}` |
| GET/POST | `/api/me/pets/:id/feed` | 아이 기록 읽기·올리기 |
| POST | `/api/transfer` | 양도 요청 `{seatLabel, fromName, toPhone}` |
| GET/POST | `/api/guestbook` | 방명록 읽기·남기기 |
| GET | `/api/admin/overview` | 관리자 전체 데이터 (`x-admin-code` 헤더) |
| POST | `/api/admin/transfers/:id` | `{action: "approve" \| "reject"}` |
| POST | `/api/admin/guestbook/:id` | `{hidden: true \| false}` |
| POST | `/api/admin/reservations/:id` | `{action: "cancel" \| "restore"}` |
| POST | `/api/admin/reset` | 예시 데이터로 되돌리기 |

쓰기 요청은 IP당 1분 40회로 제한된다.

## 아직 시제품인 부분

- 결제·본인인증은 연결되어 있지 않다. 예약은 확정까지만 동작한다.
- 휴대폰 본인인증(SMS)은 없다. 비밀번호를 잊으면 지금은 관리자가 도와줄 방법이 없다.
- 한 계정에 아이가 여럿이어도 회원 화면은 첫 아이만 보여준다.
- 기억의 방 360°/VR은 화면 전환만 되고 기울기 센서·헤드셋 연동은 없다.
- 3중 백업·전체 내려받기는 진행 표시만 흉내 낸다.
- 관리자 인증은 공용 코드 하나다. 실서비스 전에 운영자 계정·권한으로 바꿔야 한다.
