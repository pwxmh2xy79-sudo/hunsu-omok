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
