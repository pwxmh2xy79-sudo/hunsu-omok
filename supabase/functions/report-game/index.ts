// 끝난 대국을 기록하고 두 선수의 Elo를 갱신한다 (service role로 쓴다).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const K = 32;

type Req = {
  gameType?: string;
  black: { key: string; kind: "human" | "model"; provider?: string; model?: string; config?: unknown };
  white: { key: string; kind: "human" | "model"; provider?: string; model?: string; config?: unknown };
  moves: unknown[];
  result: "black" | "white" | "draw" | "abort";
  stats?: { illegal?: Record<string, number>; hint?: Record<string, { hits: number; total: number }> };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const r = (await req.json()) as Req;
    const gameType = r.gameType || "omok";
    if (!r.black?.key || !r.white?.key || !Array.isArray(r.moves)) return json({ error: "bad request" }, 400);

    for (const p of [r.black, r.white]) {
      await sb.from("players").upsert({ key: p.key, kind: p.kind, provider: p.provider ?? null, model: p.model ?? null, config: p.config ?? {} }, { onConflict: "key" });
    }
    const { error: ge } = await sb.from("games").insert({ game_type: gameType, black: r.black.key, white: r.white.key, moves: r.moves, result: r.result, stats: r.stats ?? {} });
    if (ge) throw ge;

    if (r.result === "abort") return json({ ok: true, rated: false });

    const get = async (key: string) => {
      const { data } = await sb.from("ratings").select("*").eq("player", key).eq("game_type", gameType).maybeSingle();
      return data ?? { player: key, game_type: gameType, elo: 1200, games: 0, wins: 0, losses: 0, draws: 0, illegal_moves: 0, hint_hits: 0, hint_total: 0 };
    };
    const B = await get(r.black.key), W = await get(r.white.key);
    const sb_ = r.result === "black" ? 1 : r.result === "white" ? 0 : 0.5;
    const eb = 1 / (1 + Math.pow(10, (W.elo - B.elo) / 400));
    const ew = 1 - eb;
    const same = r.black.key === r.white.key;
    const upd = (row: typeof B, s: number, e: number, key: string) => ({
      ...row,
      elo: same ? row.elo : row.elo + K * (s - e),
      games: row.games + 1,
      wins: row.wins + (s === 1 ? 1 : 0),
      losses: row.losses + (s === 0 ? 1 : 0),
      draws: row.draws + (s === 0.5 ? 1 : 0),
      illegal_moves: row.illegal_moves + (r.stats?.illegal?.[key] ?? 0),
      hint_hits: row.hint_hits + (r.stats?.hint?.[key]?.hits ?? 0),
      hint_total: row.hint_total + (r.stats?.hint?.[key]?.total ?? 0),
      updated_at: new Date().toISOString(),
    });
    // 같은 훈수꾼 혼자 쓴 판: 승패·Elo 없이 횟수·불법수·적중만 쌓는다
    const solo = (row: typeof B, key: string) => ({ ...row, games: row.games + 1,
      illegal_moves: row.illegal_moves + (r.stats?.illegal?.[key] ?? 0),
      hint_hits: row.hint_hits + (r.stats?.hint?.[key]?.hits ?? 0), hint_total: row.hint_total + (r.stats?.hint?.[key]?.total ?? 0),
      updated_at: new Date().toISOString() });
    const nb = same ? solo(B, r.black.key) : upd(B, sb_, eb, r.black.key);
    const nw = same ? nb : upd(W, 1 - sb_, ew, r.white.key);
    const rows = same ? [nb] : [nb, nw];
    const { error: re } = await sb.from("ratings").upsert(rows, { onConflict: "player,game_type" });
    if (re) throw re;
    return json({ ok: true, rated: !same, black: { elo: Math.round(nb.elo), delta: Math.round(nb.elo - B.elo) }, white: { elo: Math.round(nw.elo), delta: Math.round(nw.elo - W.elo) } });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
