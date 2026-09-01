import http from "node:http";

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://kojuboo5324-ui.github.io";
const REALTIME_MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2.1-mini";
const TEXT_MODEL = process.env.TEXT_MODEL || "gpt-5.6-luna";
const REALTIME_VOICE = process.env.REALTIME_VOICE || "marin";

const ipBuckets = new Map();

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function rateAllowed(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const limit = 50;
  const prior = ipBuckets.get(ip) || [];
  const fresh = prior.filter(t => now - t < windowMs);
  if (fresh.length >= limit) return false;
  fresh.push(now);
  ipBuckets.set(ip, fresh);
  return true;
}

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

async function readJson(req, maxBytes = 160_000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("request too large");
  }
  return JSON.parse(raw || "{}");
}

function clean(value, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function skinSummary(c = {}) {
  return [
    `연령대: ${clean(c.age, 40) || "미입력"}`,
    `성별: ${clean(c.gender, 20) || "미입력"}`,
    `고객이 가장 걱정하는 피부 고민: ${clean(c.selfConcern, 80) || "미입력"}`,
    `피부유형: ${clean(c.skinType, 80) || "미확인"}`,
    `피부 컨디션 점수: ${clean(c.condition, 20) || "미확인"}`,
    `관리 1순위: ${clean(c.primary, 80) || "미확인"}`,
    `관리 2순위: ${clean(c.secondary, 80) || "미확인"}`,
    `MAIIM 제품 경험: ${clean(c.maiim, 80) || "미입력"}`,
    `현재 사용 제품: ${clean(c.currentProduct, 120) || "미입력"}`,
    `과거 사용 제품: ${clean(c.pastProduct, 120) || "미입력"}`
  ].join("\n");
}

function assistantInstructions(c = {}) {
  return `당신은 MAIIM 피부체크 서비스의 "AI 척척 박사"라는 AI 피부관리 상담 도우미다.
항상 한국어로 말한다. 실제 전화 상담처럼 따뜻하고 자연스럽게 대화하되 답변은 보통 2~5문장으로 짧고 쉽게 한다.
고객이 한 번에 이해할 수 있도록 전문용어를 줄이고, 필요한 경우 한 가지만 되묻는다.

[현재 고객의 피부체크 결과]
${skinSummary(c)}

[제품 안내 범위]
- 현재 앱에서 상담 후 확인하는 기초 제품은 "라헬 데이케어 수분젤"과 "라헬 나이트케어 보습젤"이다.
- 두 제품은 피부체크만으로 무조건 추천하지 않는다.
- 현재 사용 중인 제품, 자극 경험, 피부 상태를 먼저 확인한 뒤 기초 보습 관리 관점에서 설명한다.
- 구입이나 더 구체적인 제품 선택을 원하면 담당 카운셀러 또는 센터 상담으로 연결할 수 있다고 안내한다.

[반드시 지킬 원칙]
- 자신이 AI라는 점을 숨기지 않는다.
- 의료인이 아니며 피부질환을 진단하거나 치료하지 않는다.
- 피부체크 결과는 생활관리·화장품 상담 참고용으로 설명한다.
- 질환명이나 치료 효과를 확정적으로 말하지 않는다.
- 처방약, 질환 진단, 치료가 필요한 질문은 의료기관 상담이 필요하다고 안내한다.
- 심한 통증, 심한 붓기, 진물, 수포, 갑자기 넓게 퍼지는 발진, 눈 주변의 심한 증상, 호흡 곤란 등 위험 신호가 나오면 AI 상담을 길게 이어가지 말고 의료기관 또는 응급진료를 권한다.
- 제품 효과나 수입을 보장하지 않는다.
- 이름, 전화번호 등 개인정보를 요구하지 않는다.
- 고객이 사람 상담을 원하면 담당 카운셀러·카카오·전화·센터 방문 상담으로 연결할 수 있다고 안내한다.
- 고객 질문에 먼저 직접 답하고, 같은 내용을 반복하지 않는다.`;
}

function outputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const parts = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === "string" && c.text.trim()) parts.push(c.text.trim());
    }
  }
  return parts.join("\n").trim();
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    if ((req.headers.origin || "") !== ALLOWED_ORIGIN) return sendJson(res, 403, { error: "origin not allowed" });
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "maiim-ai-backend-v2",
      realtime_model: REALTIME_MODEL,
      text_model: TEXT_MODEL
    });
  }

  if (req.method === "POST") {
    if ((req.headers.origin || "") !== ALLOWED_ORIGIN) {
      return sendJson(res, 403, { error: "origin not allowed" });
    }
    if (!rateAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: "잠시 후 다시 시도해 주세요." });
    }
    if (!OPENAI_API_KEY) {
      return sendJson(res, 503, { error: "OPENAI_API_KEY is not configured" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/realtime") {
    try {
      const body = await readJson(req, 400_000);
      const sdp = typeof body.sdp === "string" ? body.sdp : "";
      if (!sdp.startsWith("v=0")) return sendJson(res, 400, { error: "invalid sdp" });

      const session = {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: assistantInstructions(body.skinContext || {}),
        output_modalities: ["audio"],
        max_output_tokens: 500,
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "ko",
              prompt: "한국어 피부관리 상담. MAIIM, 라헬 데이케어 수분젤, 라헬 나이트케어 보습젤."
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: true,
              interrupt_response: true
            }
          },
          output: {
            voice: REALTIME_VOICE,
            speed: 1.0
          }
        }
      };

      const form = new FormData();
      form.append("sdp", sdp);
      form.append("session", JSON.stringify(session));

      const openai = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form
      });

      const answer = await openai.text();
      res.statusCode = openai.status;
      res.setHeader("Content-Type", openai.headers.get("content-type") || "application/sdp");
      return res.end(answer);
    } catch (err) {
      console.error("realtime", err);
      return sendJson(res, 500, { error: "AI 음성 연결에 실패했습니다." });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const body = await readJson(req);
      const message = clean(body.message, 2500);
      if (!message) return sendJson(res, 400, { error: "질문을 입력해 주세요." });

      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
      const historyText = history
        .map(x => `${x.role === "assistant" ? "AI" : "고객"}: ${clean(x.text, 1000)}`)
        .join("\n");

      const input = `${historyText ? "[최근 대화]\n" + historyText + "\n\n" : ""}[고객 질문]\n${message}`;

      const openai = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          instructions: assistantInstructions(body.skinContext || {}),
          input,
          reasoning: { effort: "low" },
          max_output_tokens: 500
        })
      });

      const data = await openai.json();
      if (!openai.ok) {
        console.error("chat OpenAI", data);
        return sendJson(res, openai.status, { error: data?.error?.message || "AI 요청에 실패했습니다." });
      }
      return sendJson(res, 200, {
        answer: outputText(data) || "지금은 답변을 만들지 못했습니다. 잠시 후 다시 질문해 주세요."
      });
    } catch (err) {
      console.error("chat", err);
      return sendJson(res, 500, { error: "AI 글자상담에 실패했습니다." });
    }
  }

  return sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MAIIM AI backend V2 listening on ${PORT}`);
});
