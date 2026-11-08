# 훈수 오목

훈수꾼 AI가 옆에서 수를 읽어 주는 15줄 오목. 한 코드로 Android와 iOS를 냅니다.

## 구성

- `web/` — 게임 본체(판·규칙·훈수 엔진). 브라우저에서 `web/index.html`을 열면 그대로 돌아갑니다.
- `capacitor.config.json` — 앱 ID `com.zeron.hunsuomok`, 앱 이름 "훈수 오목".
- `.github/workflows/android.yml` — `main`에 push하면 APK를 자동으로 만들어 Actions → Artifacts에 올립니다. `v1.0.0` 같은 태그를 붙이면 Releases에도 붙습니다.
- `.github/workflows/ios.yml` — 수동 실행 또는 태그 때 macOS 러너에서 iOS 시뮬레이터 빌드.

## APK 받기

1. GitHub 저장소 → **Actions** → 가장 최근 "Android build"
2. 아래 **Artifacts**에서 `hunsu-omok-debug-apk` 다운로드
3. 압축을 풀어 `app-debug.apk`를 폰에 설치 (출처 불명 앱 허용 필요)

## 플레이스토어용 서명 빌드

저장소 Settings → Secrets and variables → Actions에 네 개를 넣으면 AAB도 자동으로 나옵니다.

| Secret | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i release.keystore` 결과 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | 키 별칭 |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

## 로컬에서

```bash
npm install
npx cap add android   # 처음 한 번
npx cap sync
npx cap open android  # Android Studio
```

## 다음 단계

1. Supabase — 회원가입(이메일 + 카카오 로그인), 프로필
2. 온라인 대국(방 코드·랜덤 매칭) + Elo 랭킹
3. AI 설정(추론 깊이·모델) + LLM 해설 + 구독 결제(RevenueCat)

## 훈수 경기장 (모델 평가)

모델은 두지 않는다. 사람이 두고, 모델은 **훈수만** 둔다.

- 흑·백은 사람(한 폰에서 번갈아) 또는 연습 상대(엔진).
- 훈수꾼 자리: 엔진(항상), GPT(켜고 끔), Gemini(켜고 끔). 3수부터 자동, 버튼으로는 첫 수부터.
- 매 수마다 모델 훈수꾼들이 같은 판을 보고 각자 한 자리를 찍는다. 판 위에 G(GPT)·Ge(Gemini) 표식.
- 채점: 엔진 1순위/상위 3 일치, 둘 수 없는 자리(불법수), 사람이 따랐는지(채택), 응답 시간.
- 두 훈수꾼이 다 답한 수는 엔진 점수로 승패를 가르고, 판이 끝나면 그 합으로 훈수꾼끼리 Elo를 갱신한다.
- 선수 키 `provider:model[:추론깊이]` — 같은 모델도 추론 낮음/보통/높음이 다른 줄.

서버는 Supabase 프로젝트 `hunsu-omok`(서울).

- `supabase/functions/llm-move` — 판을 보여주고 훈수 한 자리를 받음. 불법수는 한 번 되묻고, 두 번이면 무효.
- `supabase/functions/report-game` — 판이 끝나면 기록하고 (훈수꾼, 종목)별 Elo·불법수·적중을 갱신.
- 테이블: `players`, `games`, `ratings`, 뷰 `leaderboard`. 읽기는 공개, 쓰기는 서버 함수만.
- 비밀값: Edge Functions Secrets에 `OPENAI_API_KEY`, `GEMINI_API_KEY`.
