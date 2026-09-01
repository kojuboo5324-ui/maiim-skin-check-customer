# MAIIM AI 척척 박사 백엔드 V2

고객용 GitHub Pages 앱과 OpenAI API 사이의 Railway 백엔드입니다.

## Railway Variables
- OPENAI_API_KEY = 본인의 OpenAI API 키
- ALLOWED_ORIGIN = https://kojuboo5324-ui.github.io
- REALTIME_MODEL = gpt-realtime-2.1-mini
- TEXT_MODEL = gpt-5.6-luna
- REALTIME_VOICE = marin

## 중요
API 키는 GitHub의 index.html, README, .env.example에 실제 값으로 적지 마세요.
반드시 Railway의 Variables 메뉴에만 저장하세요.

## 정상 확인
배포된 Railway 주소 뒤에 `/health`를 붙여 엽니다.

예:
https://내서버.up.railway.app/health

`"ok":true`가 보이면 백엔드가 정상 실행 중입니다.
