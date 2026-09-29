import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { empresaEdgar } from "../src/edgar/cliente.ts";
import type { Empresa } from "../src/engine/tipos.ts";

/**
 * Baja de EDGAR las empresas pedidas y las guarda en data/snapshot.json, que el build embebe en la
 * página publicada (que no puede consultar EDGAR por sí misma).
 *
 *   SEC_USER_AGENT="Tu Nombre tu@email.com" npm run snapshot -- KO JNJ NUE
 *   npm run snapshot -- KO=61.5 JNJ=155        # precio a mano
 *   npm run snapshot -- --agregar XOM          # suma al snapshot existente
 *
 * Sin tickers, usa una lista por defecto variada (consumo, salud, industria, energía, bancos, tecnología).
 */
const POR_DEFECTO = ["KO", "PG", "JNJ", "PFE", "MMM", "CAT", "NUE", "XOM", "CVX", "JPM", "WFC", "WMT", "HD", "T", "VZ", "INTC", "MSFT", "AAPL", "F", "MO"];

const args = process.argv.slice(2);
const agregar = args.includes("--agregar");
const pedidos = args.filter(a => !a.startsWith("--"));
const lista = (pedidos.length ? pedidos : POR_DEFECTO).map(a => {
  const [t, p] = a.split("=");
  return { ticker: t.toUpperCase(), precio: p ? Number(p) : undefined };
});

const previas: Empresa[] = agregar && existsSync("data/snapshot.json") ? JSON.parse(await readFile("data/snapshot.json", "utf8")).empresas : [];
const out = new Map(previas.map(e => [e.ticker, e]));
const fallidas: string[] = [];
for (const { ticker, precio } of lista) {
  try {
    const e = await empresaEdgar(ticker, precio);
    if (!(e.precio > 0)) { fallidas.push(`${ticker}: sin precio (pasalo como ${ticker}=precio)`); continue; }
    out.set(e.ticker, e);
    console.log(`✓ ${e.ticker.padEnd(6)} ${e.nombre} · ejercicio ${e.fuente?.cierre} · precio ${e.precio}`);
  } catch (err) {
    fallidas.push(`${ticker}: ${(err as Error).message}`);
  }
}
await mkdir("data", { recursive: true });
await writeFile("data/snapshot.json", JSON.stringify({ generado: new Date().toISOString(), empresas: [...out.values()] }, null, 1));
console.log(`\n${out.size} empresas en data/snapshot.json.`);
if (fallidas.length) console.log("No se pudieron agregar:\n  " + fallidas.join("\n  "));
