// 모델에게 판을 보여주고 한 수를 받는다. OpenAI·Gemini. 불법수는 한 번 되물은 뒤 기록한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const N = 15;
const COLS = "ABCDEFGHIJKLMNO";

type Msg = { role: "user" | "assistant"; content: string };
type Req = {
  board: number[][];           // 0 빈칸, 1 흑, 2 백
  toMove: 1 | 2;
  history?: string[];          // ["H8","I8",...]
  model?: { provider?: "openai" | "google"; name?: string; temperature?: number; reasoning?: "low" | "medium" | "high" };
};
type Out = { move?: string; reason?: string; ms: number; usage?: unknown };

function boardText(b: number[][]) {
  let s = "   " + COLS.split("").join(" ") + "\n";
  for (let y = 0; y < N; y++) {
    s += String(y + 1).padStart(2, " ") + " " + b[y].map((v) => (v === 0 ? "." : v === 1 ? "X" : "O")).join(" ") + "\n";
  }
  return s;
}
function parseMove(m: string) {
  const t = (m || "").trim().toUpperCase().replace(/\s+/g, "");
  const r = /^([A-O])(\d{1,2})$/.exec(t);
  if (!r) return null;
  const x = COLS.indexOf(r[1]), y = parseInt(r[2], 10) - 1;
  if (x < 0 || y < 0 || y >= N) return null;
  return { x, y };
}
function parseJson(content: string): { move?: string; reason?: string } {
  try { return JSON.parse(content); } catch { /* fallthrough */ }
  const m = /\{[\s\S]*\}/.exec(content);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fallthrough */ } }
  return { move: content };
}

async function askOpenAI(apiKey: string, name: string, temperature: number, reasoning: string | undefined, sys: string, msgs: Msg[]): Promise<Out> {
  const body: Record<string, unknown> = {
    model: name,
    messages: [{ role: "system", content: sys }, ...msgs],
    response_format: { type: "json_schema", json_schema: { name: "omok_move", strict: true,
      schema: { type: "object", properties: { move: { type: "string" }, reason: { type: "string" } }, required: ["move", "reason"], additionalProperties: false } } },
  };
  if (/^(o\d|gpt-5)/.test(name)) { if (reasoning) body.reasoning_effort = reasoning; }   // 추론 모델: 깊이
  else body.temperature = temperature;                                                   // 일반 모델: 온도
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return { ...parseJson(j.choices?.[0]?.message?.content ?? "{}"), ms, usage: j.usage };
}

async function askGemini(apiKey: string, name: string, temperature: number, reasoning: string | undefined, sys: string, msgs: Msg[]): Promise<Out> {
  const generationConfig: Record<string, unknown> = {
    temperature,
    responseMimeType: "application/json",
    responseSchema: { type: "OBJECT", properties: { move: { type: "STRING" }, reason: { type: "STRING" } }, required: ["move", "reason"] },
  };
  // 2.5 계열: 생각 예산으로 깊이를 잡는다 (pro는 끌 수 없어 최소치)
  if (/gemini-(2\.5|3)/.test(name) && reasoning) {
    const pro = /pro/.test(name);
    const budget = reasoning === "low" ? (pro ? 128 : 0) : reasoning === "high" ? 8192 : -1;
    if (budget !== -1) generationConfig.thinkingConfig = { thinkingBudget: budget };
  }
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig,
  };
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return { ...parseJson(text || "{}"), ms, usage: j.usageMetadata };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { board, toMove, history = [], model = {} } = (await req.json()) as Req;
    if (!Array.isArray(board) || board.length !== N) return json({ error: "board" }, 400);
    const provider = model.provider || "openai";
    const name = model.name || (provider === "google" ? "gemini-2.5-flash" : "gpt-4.1-mini");
    const temperature = model.temperature ?? 0.2;
    const apiKey = Deno.env.get(provider === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY");
    if (!apiKey) return json({ error: (provider === "google" ? "GEMINI_API_KEY" : "OPENAI_API_KEY") + "가 서버에 설정되지 않았습니다." }, 500);
    const ask = provider === "google" ? askGemini : askOpenAI;

    const me = toMove === 1 ? "X (흑)" : "O (백)";
    const sys =
      `당신은 15x15 오목(五目) 선수입니다. 가로·세로·대각선으로 돌 다섯 개를 먼저 이으면 이깁니다. ` +
      `당신의 돌은 ${me}입니다. 반드시 빈칸(.)에만 두세요. ` +
      `좌표는 열 문자(A~O)+행 숫자(1~15)로 씁니다. 예: H8. ` +
      `JSON으로만 답합니다: {"move":"H8","reason":"한두 문장"}`;
    const msgs: Msg[] = [{ role: "user", content: `현재 판:\n${boardText(board)}\n지금까지 수순: ${history.join(" ") || "(없음)"}\n당신 차례입니다.` }];

    let illegal = 0, totalMs = 0, last: Out | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await ask(apiKey, name, temperature, model.reasoning, sys, msgs);
      totalMs += last.ms;
      const mv = parseMove(last.move || "");
      if (mv && board[mv.y][mv.x] === 0) {
        return json({ x: mv.x, y: mv.y, move: last.move, reason: last.reason || "", illegal, ms: totalMs, provider, model: name, usage: last.usage });
      }
      illegal++;
      msgs.push({ role: "assistant", content: JSON.stringify({ move: last.move, reason: last.reason }) });
      msgs.push({ role: "user", content: `${last.move}는 둘 수 없는 자리입니다(판 밖이거나 이미 돌이 있음). 빈칸(.)을 골라 다시 두세요.` });
    }
    return json({ forfeit: true, illegal, ms: totalMs, provider, model: name, reason: last?.reason || "", move: last?.move });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
