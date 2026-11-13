// 맞은편의 말 한 줄. 페이지가 만든 프롬프트를 Claude에게 넘기고 {"say"}만 돌려준다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다." }, 500);
    const { prompt, model } = (await req.json()) as { prompt?: string; model?: string };
    if (!prompt || prompt.length > 20000) return json({ error: "prompt" }, 400);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: model || "claude-haiku-5-5", max_tokens: 300, temperature: 0.9,
        messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return json({ error: `anthropic ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
    const j = await res.json();
    const text = (j.content ?? []).filter((p: { type: string }) => p.type === "text").map((p: { text?: string }) => p.text ?? "").join("");
    let say = "";
    try { say = String(JSON.parse(text).say ?? ""); } catch {
      const m = /\{[\s\S]*\}/.exec(text); if (m) { try { say = String(JSON.parse(m[0]).say ?? ""); } catch { /* noop */ } }
      if (!say) say = text.replace(/^[\s"{}]+|[\s"{}]+$/g, "").replace(/^say\s*:\s*/i, "");
    }
    return json({ say, usage: j.usage });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
