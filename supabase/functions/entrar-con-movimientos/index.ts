// Login único: recibe la sesión de Taller - Movimientos (local26.vercel.app), la verifica contra
// ese proyecto y devuelve un código de un solo uso para abrir la sesión de Sobres del mismo usuario.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const HUB_URL = "https://rcrbdlrrswkvljkzprpp.supabase.co";
const HUB_KEY = "sb_publishable_vmM9ijMMy7hmNMOW6m5oXA_wYokmmlL";
const ORIGENES = ["https://local26.vercel.app", "https://joyeria-dw-zip.vercel.app", "http://localhost:4173"];

Deno.serve(async (req) => {
  const origen = req.headers.get("origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ORIGENES.includes(origen) ? origen : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const responder = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405);

  let token = "";
  try { token = String((await req.json()).token ?? ""); } catch { /* cuerpo inválido */ }
  if (!token) return responder({ error: "Falta la sesión" }, 400);

  // 1) ¿La sesión de Movimientos es válida? Supabase de Movimientos lo confirma.
  const r = await fetch(`${HUB_URL}/auth/v1/user`, { headers: { apikey: HUB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return responder({ error: "La sesión de Movimientos no es válida" }, 401);
  const email = String((await r.json()).email ?? "").toLowerCase();
  if (!email) return responder({ error: "Sin email" }, 401);

  // 2) Mismo email en Sobres y autorizado
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.user) return responder({ error: "Ese usuario no existe en Sobres" }, 403);
  const { data: aut } = await admin.from("usuarios_autorizados").select("user_id").eq("user_id", link.user.id).maybeSingle();
  if (!aut) return responder({ error: "Usuario no autorizado en Sobres" }, 403);

  // 3) Código de un solo uso; el navegador lo canjea por la sesión (no se manda ningún mail)
  return responder({ token_hash: link.properties.hashed_token });
});
