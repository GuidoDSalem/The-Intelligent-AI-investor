import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { analizar, validarEmpresa } from "../engine/analisis.ts";
import { promptS2 } from "../engine/sistema2.ts";
import type { Empresa } from "../engine/tipos.ts";
import { buscar, cotizaciones, empresaEdgar } from "../edgar/cliente.ts";
import type { CeldaMapa, Snapshot } from "../engine/snapshot.ts";
import { ErrorEdgar } from "../edgar/xbrl.ts";
import { claudeDisponible, consultarS2, ErrorS2, MODELO_S2 } from "./claude.ts";

/**
 * Servidor local: sirve la app (dist/web) y una API chica.
 *   GET  /api/estado                 qué fuentes están disponibles
 *   GET  /api/buscar?q=coca          autocompletado de tickers de EDGAR
 *   GET  /api/empresa/KO?precio=62   datos de EDGAR ya convertidos a `Empresa`
 *   GET  /api/mapa                   el mapa del snapshot con precios y variación del día en vivo
 *   POST /api/sistema2               { empresa } → razonamiento de Claude
 */
const PUERTO = Number(process.env.PORT || 5173);
const WEB = path.resolve("dist/web");
const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

function json(res: ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(cuerpo));
}

async function leerCuerpo(req: IncomingMessage, max = 200_000): Promise<unknown> {
  let s = "";
  for await (const trozo of req) { s += trozo; if (s.length > max) throw new Error("Cuerpo demasiado grande"); }
  return JSON.parse(s || "{}");
}

/** Mapa del mercado: universo y sectores del snapshot, precios en vivo (Yahoo, lotes de 20, caché de 5 min). */
async function mapaEnVivo(): Promise<{ fecha: string; mapa: CeldaMapa[] }> {
  let snap: Snapshot;
  try { snap = JSON.parse(await readFile(path.resolve("data/snapshot.json"), "utf8")); } catch { return { fecha: "", mapa: [] }; }
  const base = snap.mapa ?? [];
  const cots = await cotizaciones(base.map(c => c.ticker));
  let fecha = "";
  const mapa = base.map(c => {
    const q = cots.get(c.ticker);
    if (!q) return c;
    fecha = q.fecha > fecha ? q.fecha : fecha;
    return { ...c, cap: Math.round(c.cap * (q.precio / c.precio)), precio: q.precio, variacion: q.variacion ?? c.variacion };
  });
  return { fecha: fecha || snap.generado.slice(0, 10), mapa };
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === "/api/mapa") return json(res, 200, await mapaEnVivo());
  if (url.pathname === "/api/estado") {
    return json(res, 200, { edgar: !!process.env.SEC_USER_AGENT, claude: claudeDisponible(), modeloS2: MODELO_S2, precios: process.env.PRECIOS !== "off" });
  }
  if (url.pathname === "/api/buscar") return json(res, 200, await buscar(url.searchParams.get("q") ?? ""));
  const m = url.pathname.match(/^\/api\/empresa\/([A-Za-z0-9.\-]{1,12})$/);
  if (m) {
    const precio = Number(url.searchParams.get("precio"));
    return json(res, 200, await empresaEdgar(m[1], precio > 0 ? precio : undefined));
  }
  if (url.pathname === "/api/sistema2" && req.method === "POST") {
    if (!claudeDisponible()) return json(res, 503, { error: "El servidor no tiene credenciales de Anthropic (ANTHROPIC_API_KEY)." });
    const { empresa } = (await leerCuerpo(req)) as { empresa?: Empresa };
    const err = empresa ? validarEmpresa(empresa) : "Falta la empresa.";
    if (err) return json(res, 400, { error: err });
    return json(res, 200, await consultarS2(promptS2(analizar(empresa!))));
  }
  return json(res, 404, { error: "Ruta desconocida." });
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const archivo = path.resolve(WEB, rel);
    if (!archivo.startsWith(WEB + path.sep)) return json(res, 403, { error: "Ruta inválida." });
    const datos = await readFile(archivo);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo)] ?? "application/octet-stream" });
    res.end(datos);
  } catch (e) {
    if (e instanceof ErrorEdgar) return json(res, 422, { error: e.message });
    if (e instanceof ErrorS2) return json(res, e.status, { error: e.message });
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return json(res, 404, { error: "No existe. ¿Corriste npm run build?" });
    console.error(e);
    json(res, 500, { error: "Error interno: " + (e as Error).message });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Motor Graham en http://localhost:${PUERTO}`);
  if (!process.env.SEC_USER_AGENT) console.log("  · EDGAR desactivado: definí SEC_USER_AGENT=\"Tu Nombre tu@email.com\"");
  if (!claudeDisponible()) console.log("  · Sistema 2 desactivado: definí ANTHROPIC_API_KEY para habilitarlo");
});
