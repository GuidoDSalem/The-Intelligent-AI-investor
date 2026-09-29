import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Empresa } from "../engine/tipos.ts";
import { type CompanyFacts, empresaDesdeEdgar, ErrorEdgar, type Submissions } from "./xbrl.ts";

/**
 * Acceso a SEC EDGAR. La SEC pide identificarse con un User-Agent del tipo
 * "Nombre Apellido email@dominio" y no más de 10 pedidos por segundo:
 * https://www.sec.gov/os/accessing-edgar-data
 */
const CACHE = path.resolve(".cache/edgar");
const UN_DIA = 24 * 3600 * 1000;

export function userAgent(): string {
  const ua = process.env.SEC_USER_AGENT?.trim();
  if (!ua) throw new ErrorEdgar("Falta la variable SEC_USER_AGENT (por ejemplo: SEC_USER_AGENT=\"Tu Nombre tu@email.com\"). La SEC la exige para usar EDGAR.");
  return ua;
}

let ultimoPedido = 0;
async function pedir(url: string): Promise<unknown> {
  const espera = ultimoPedido + 150 - Date.now();
  if (espera > 0) await new Promise(r => setTimeout(r, espera));
  ultimoPedido = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": userAgent(), "Accept-Encoding": "gzip, deflate", Accept: "application/json" } });
  } catch (e) {
    throw new ErrorEdgar(`No pude conectarme a EDGAR (${(e as Error).message}). Revisá la conexión a internet.`);
  }
  if (res.status === 404) throw new ErrorEdgar("EDGAR no tiene datos para esa empresa.");
  if (res.status === 403) throw new ErrorEdgar("EDGAR rechazó el pedido (403). Revisá que SEC_USER_AGENT tenga tu nombre y email.");
  if (!res.ok) throw new ErrorEdgar(`EDGAR respondió ${res.status}.`);
  return res.json();
}

async function conCache<T>(nombre: string, url: string, ttl = UN_DIA): Promise<T> {
  const archivo = path.join(CACHE, nombre);
  try {
    const st = await stat(archivo);
    if (Date.now() - st.mtimeMs < ttl) return JSON.parse(await readFile(archivo, "utf8")) as T;
  } catch { /* no está en caché */ }
  const datos = await pedir(url);
  await mkdir(CACHE, { recursive: true });
  await writeFile(archivo, JSON.stringify(datos));
  return datos as T;
}

export interface TickerSec { cik: string; ticker: string; nombre: string }

let tickers: TickerSec[] | null = null;
export async function listaTickers(): Promise<TickerSec[]> {
  if (tickers) return tickers;
  const raw = await conCache<Record<string, { cik_str: number; ticker: string; title: string }>>(
    "company_tickers.json", "https://www.sec.gov/files/company_tickers.json", 7 * UN_DIA);
  tickers = Object.values(raw).map(t => ({ cik: String(t.cik_str).padStart(10, "0"), ticker: t.ticker.toUpperCase(), nombre: t.title }));
  return tickers;
}

export async function buscar(q: string, max = 8): Promise<TickerSec[]> {
  const t = q.trim().toUpperCase();
  if (!t) return [];
  const lista = await listaTickers();
  const exactos = lista.filter(x => x.ticker === t);
  const prefijo = lista.filter(x => x.ticker !== t && x.ticker.startsWith(t));
  const nombre = lista.filter(x => !x.ticker.startsWith(t) && x.nombre.toUpperCase().includes(t));
  return [...exactos, ...prefijo, ...nombre].slice(0, max);
}

export async function datosCrudos(ticker: string) {
  const t = ticker.trim().toUpperCase();
  const info = (await listaTickers()).find(x => x.ticker === t);
  if (!info) throw new ErrorEdgar(`No encontré el ticker ${t} en EDGAR. Sólo están las empresas que presentan balances ante la SEC; para otras, cargá los datos a mano.`);
  const cf = await conCache<CompanyFacts>(`facts-${info.cik}.json`, `https://data.sec.gov/api/xbrl/companyfacts/CIK${info.cik}.json`);
  const sub = await conCache<Submissions>(`sub-${info.cik}.json`, `https://data.sec.gov/submissions/CIK${info.cik}.json`);
  return { info, cf, sub };
}

export interface Cotizacion { precio: number; fecha: string; fuente: string }

/**
 * Último precio de cierre. Prueba Stooq y después Yahoo Finance (ninguno pide clave).
 * Es opcional: si ambos fallan devuelve null y el usuario ingresa el precio. PRECIOS=off lo desactiva.
 */
export async function cotizacion(ticker: string): Promise<Cotizacion | null> {
  if (process.env.PRECIOS === "off") return null;
  return (await precioStooq(ticker)) ?? (await precioYahoo(ticker));
}

async function precioStooq(ticker: string): Promise<Cotizacion | null> {
  const sym = ticker.toLowerCase().replace(/\./g, "-") + ".us";
  try {
    const res = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const [, fila] = (await res.text()).trim().split(/\r?\n/);
    const cols = fila?.split(",") ?? [];
    const cierre = Number(cols[6]);
    return Number.isFinite(cierre) && cierre > 0 ? { precio: cierre, fecha: cols[1], fuente: "Stooq (cierre)" } : null;
  } catch {
    return null;
  }
}

async function precioYahoo(ticker: string): Promise<Cotizacion | null> {
  const sym = ticker.toUpperCase().replace(/\./g, "-");
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const meta = ((await res.json()) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[] } }).chart?.result?.[0]?.meta;
    const p = meta?.regularMarketPrice;
    if (!p || !(p > 0)) return null;
    const fecha = meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10) : "";
    return { precio: p, fecha, fuente: "Yahoo Finance" };
  } catch {
    return null;
  }
}

/** Empresa lista para el motor. Si no hay precio, `precio` queda en 0 y la interfaz lo pide. */
export async function empresaEdgar(ticker: string, precioManual?: number): Promise<Empresa> {
  const { info, cf, sub } = await datosCrudos(ticker);
  const cot = precioManual ? null : await cotizacion(info.ticker);
  const e = empresaDesdeEdgar(cf, sub, info.ticker, precioManual ?? cot?.precio ?? null);
  e.fuente = { ...e.fuente!, precioFuente: precioManual ? "ingresado a mano" : cot?.fuente, precioFecha: cot?.fecha };
  return e;
}
