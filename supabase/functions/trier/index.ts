// aug.mente — « Vide ta tête » : tri par l'IA (offre Pro)
// Reçoit le texte dicté, renvoie chaque élément rangé dans une famille.
// Déploiement : voir supabase/functions/trier/LISEZMOI.md
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Clé serveur : ancienne (service_role) ou nouvelle (sb_secret_…)
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); return String(Object.values(k)[0] ?? ""); } catch { return ""; }
})();
const MODEL = Deno.env.get("TRIER_MODEL") ?? "claude-haiku-5-5";
const MONTHLY_LIMIT = Number(Deno.env.get("TRIER_LIMITE_MOIS") ?? "600");
const CATS = ["agenda", "aujourdhui", "semaine", "rituel", "cap", "idee"];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  // 1. Qui appelle ?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: "Connectez-vous pour utiliser le tri par l’IA." }, 401);

  // 2. Offre Pro uniquement
  const { data: prof } = await admin.from("profiles").select("plan,is_admin").eq("id", user.id).maybeSingle();
  if (!prof || (prof.plan !== "pro" && !prof.is_admin)) return json({ error: "Le tri par l’IA fait partie de l’offre Pro." }, 403);

  // 3. Quota mensuel (partagé avec le coach)
  const month = new Date().toISOString().slice(0, 7);
  const { data: use } = await admin.from("ai_usage").select("calls").eq("user_id", user.id).eq("month", month).maybeSingle();
  const calls = use?.calls ?? 0;
  if (calls >= MONTHLY_LIMIT) return json({ error: "Limite mensuelle atteinte. Le tri se fait sur l’appareil." }, 429);

  // 4. Le texte
  let body: { text?: string; today?: string } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const text = String(body.text ?? "").trim().slice(0, 4000);
  if (!text) return json({ error: "Rien à ranger." }, 400);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today)) ? String(body.today) : new Date().toISOString().slice(0, 10);
  const weekday = JOURS[new Date(today + "T12:00:00Z").getUTCDay()];

  const system = `Tu ranges ce qu'une personne a dicté d'un trait dans son organiseur, souvent sans ponctuation.
Date du jour : ${today} (${weekday}).
Découpe le texte en éléments distincts. Un élément = une seule chose à faire, à se rappeler ou à garder.
Range chacun dans UNE catégorie :
- "agenda" : un moment précis avec une heure (rendez-vous, dîner, appel à heure fixe)
- "aujourdhui" : une action à faire aujourd'hui, sans heure
- "semaine" : une action sans urgence du jour, ou prévue un autre jour sans heure
- "rituel" : une habitude qui revient (chaque jour, chaque matin, en semaine…)
- "cap" : un objectif plus long, avec une échéance lointaine ou sans échéance
- "idee" : une idée, une envie, une note à garder
Titre : court, en français, à l'infinitif ou en nom (2 à 8 mots), sans la date ni l'heure, sans « il faut que je ».
"date" : AAAA-MM-JJ si un jour est dit ou se déduit (demain, vendredi, le 15…), sinon null.
"time" : HH:MM si une heure est dite, sinon null.
"freq" : pour un rituel, « Le matin », « Le soir », « Du lundi au vendredi » ou « Chaque jour » ; sinon null.
N'invente rien qui n'est pas dans le texte. Ne fusionne pas deux choses différentes.
Réponds uniquement avec un objet JSON : {"items":[{"cat":"…","title":"…","date":null,"time":null,"freq":null}]}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: `Texte dicté :\n"""${text}"""` }],
    }),
  });
  if (!res.ok) return json({ error: "L’IA n’a pas pu répondre. Le tri se fait sur l’appareil." }, 502);

  // 5. Lecture et contrôle de la réponse
  const out = await res.json();
  const raw = (out?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("");
  let parsed: { items?: unknown[] } = {};
  try { parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { /* invalide */ }
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => x && CATS.includes(String(x.cat)) && String(x.title ?? "").trim())
    .slice(0, 40)
    .map((x) => ({
      cat: String(x.cat),
      title: String(x.title).trim().slice(0, 160),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.date)) ? String(x.date) : null,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x.time)) ? String(x.time) : null,
      freq: x.freq ? String(x.freq).slice(0, 40) : null,
    }));
  if (!items.length) return json({ error: "Rien de rangé." }, 422);

  await admin.from("ai_usage").upsert({ user_id: user.id, month, calls: calls + 1 }, { onConflict: "user_id,month" });
  return json({ items });
});
