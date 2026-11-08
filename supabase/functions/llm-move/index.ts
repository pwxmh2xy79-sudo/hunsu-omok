// 모델에게 판을 보여주고 한 수를 받는다. 불법수는 한 번 되물은 뒤 기록한다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const N = 15;
const COLS = "ABCDEFGHIJKLMNO";

type Req = {
  board: number[][];           // 0 빈칸, 1 흑, 2 백
  toMove: 1 | 2;
  history?: string[];          // ["H8","I8",...]
  model?: { name?: string; temperature?: number; reasoning?: string };
};

function boardText(b: number[][]) {
  let s = "   " + COLS.split("").join(" ") + "\n";
  for (let y = 0; y < N; y++) {
    s += String(y + 1).padStart(2, " ") + " " +
      b[y].map((v) => (v === 0 ? "." : v === 1 ? "X" : "O")).join(" ") + "\n";
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

async function askOpenAI(apiKey: string, model: string, temperature: number, reasoning: string | undefined, messages: unknown[]) {
  const body: Record<string, unknown> = {
    model,
    messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "omok_move",
        strict: true,
        schema: {
          type: "object",
          properties: { move: { type: "string" }, reason: { type: "string" } },
          required: ["move", "reason"],
          additionalProperties: false,
        },
      },
    },
  };
  // 추론 모델(gpt-5, o 계열)은 temperature 대신 reasoning_effort
  if (/^(o\d|gpt-5)/.test(model)) { if (reasoning) body.reasoning_effort = reasoning; }
  else body.temperature = temperature;

  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? "{}";
  let out: { move?: string; reason?: string } = {};
  try { out = JSON.parse(content); } catch { out = { move: content }; }
  return { ...out, ms, usage: j.usage };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY가 설정되지 않았습니다." }, 500);
    const { board, toMove, history = [], model = {} } = (await req.json()) as Req;
    if (!Array.isArray(board) || board.length !== N) return json({ error: "board" }, 400);

    const name = model.name || "gpt-4.1-mini";
    const temperature = model.temperature ?? 0.2;
    const me = toMove === 1 ? "X (흑)" : "O (백)";
    const sys =
      `당신은 15x15 오목(五目) 선수입니다. 가로·세로·대각선으로 돌 다섯 개를 먼저 이으면 이깁니다. ` +
      `당신의 돌은 ${me}입니다. 반드시 빈칸(.)에만 두세요. ` +
      `좌표는 열 문자(A~O)+행 숫자(1~15)로 씁니다. 예: H8. ` +
      `JSON으로만 답합니다: {"move":"H8","reason":"한두 문장"}`;
    const user = `현재 판:\n${boardText(board)}\n지금까지 수순: ${history.join(" ") || "(없음)"}\n당신 차례입니다.`;
    const messages: unknown[] = [{ role: "system", content: sys }, { role: "user", content: user }];

    let illegal = 0, totalMs = 0, last: { move?: string; reason?: string; ms: number; usage?: unknown } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      last = await askOpenAI(apiKey, name, temperature, model.reasoning, messages);
      totalMs += last.ms;
      const mv = parseMove(last.move || "");
      if (mv && board[mv.y][mv.x] === 0) {
        return json({ x: mv.x, y: mv.y, move: last.move, reason: last.reason || "", illegal, ms: totalMs, model: name, usage: last.usage });
      }
      illegal++;
      messages.push({ role: "assistant", content: JSON.stringify({ move: last.move, reason: last.reason }) });
      messages.push({ role: "user", content: `${last.move}는 둘 수 없는 자리입니다(판 밖이거나 이미 돌이 있음). 빈칸(.)을 골라 다시 두세요.` });
    }
    // 두 번 다 불법수: 몰수. 클라이언트가 기록하고 임의 빈칸으로 대신 둔다.
    return json({ forfeit: true, illegal, ms: totalMs, model: name, reason: last?.reason || "", move: last?.move });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
