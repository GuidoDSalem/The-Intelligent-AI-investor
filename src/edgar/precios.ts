/**
 * Precios y variación del día desde Yahoo Finance (sin clave).
 *
 * - Se usa el endpoint "spark", que devuelve hasta 20 símbolos por llamada: menos pedidos, menos 429.
 * - Yahoo rechaza con 429 los pedidos con un User-Agent mínimo; se manda uno de navegador completo.
 * - Si query1 falla se prueba query2, y ante un 429 se espera y se reintenta una vez.
 * - Caché en memoria de 5 minutos. PRECIOS=off desactiva todo.
 * (Stooq dejó de publicar su CSV de cotizaciones: su endpoint responde 404.)
 */
export interface Cotizacion {
  precio: number;
  fecha: string;
  fuente: string;
  /** Variación del día en %, si Yahoo la informa. */
  variacion?: number;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const POR_LLAMADA = 20;
const TTL = 5 * 60 * 1000;
const cache = new Map<string, { t: number; c: Cotizacion | null }>();

/** Último motivo de falla, para mostrarlo al usuario en vez de un "no pude" genérico. */
export let ultimoError = "";

const simbolo = (ticker: string) => ticker.toUpperCase().replace(/\./g, "-");
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Spark {
  [sym: string]: { symbol?: string; close?: number[]; timestamp?: number[]; chartPreviousClose?: number; fulldayPrice?: number; fulldayChangePercent?: number } | undefined;
}

async function pedirSpark(simbolos: string[]): Promise<Spark | null> {
  const qs = `symbols=${encodeURIComponent(simbolos.join(","))}&range=1d&interval=1d`;
  for (const host of HOSTS) {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const res = await fetch(`https://${host}/v8/finance/spark?${qs}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (res.status === 429) { ultimoError = "Yahoo Finance limitó los pedidos (429)"; await espera(1500 * (intento + 1)); continue; }
        if (!res.ok) { ultimoError = `Yahoo Finance respondió ${res.status}`; break; }
        return (await res.json()) as Spark;
      } catch (e) {
        ultimoError = `No pude conectarme a Yahoo Finance (${(e as Error).message})`;
        break;
      }
    }
  }
  return null;
}

/** Cotizaciones de muchos tickers a la vez. Los que Yahoo no conoce quedan en null. */
export async function cotizaciones(tickers: string[]): Promise<Map<string, Cotizacion | null>> {
  const out = new Map<string, Cotizacion | null>();
  if (process.env.PRECIOS === "off") { for (const t of tickers) out.set(t, null); return out; }
  const faltan: string[] = [];
  for (const t of tickers) {
    const c = cache.get(t);
    if (c && Date.now() - c.t < TTL) out.set(t, c.c); else faltan.push(t);
  }
  for (let i = 0; i < faltan.length; i += POR_LLAMADA) {
    const grupo = faltan.slice(i, i + POR_LLAMADA);
    const r = await pedirSpark(grupo.map(simbolo));
    for (const t of grupo) {
      const d = r?.[simbolo(t)];
      const precio = d?.fulldayPrice ?? d?.close?.at(-1);
      const ts = d?.timestamp?.at(-1);
      const cot: Cotizacion | null = precio && precio > 0 ? {
        precio,
        fecha: ts ? new Date(ts * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        fuente: "Yahoo Finance",
        variacion: d?.fulldayChangePercent ?? (d?.chartPreviousClose ? (precio / d.chartPreviousClose - 1) * 100 : undefined),
      } : null;
      if (r) cache.set(t, { t: Date.now(), c: cot });
      if (r && !cot) ultimoError = `Yahoo Finance no tiene cotización para ${t}`;
      out.set(t, cot);
    }
  }
  return out;
}

export async function cotizacion(ticker: string): Promise<Cotizacion | null> {
  return (await cotizaciones([ticker])).get(ticker) ?? null;
}
