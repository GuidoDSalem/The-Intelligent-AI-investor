import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { empresaEdgar } from "../src/edgar/cliente.ts";
import type { Empresa } from "../src/engine/tipos.ts";

/**
 * Baja de EDGAR las empresas pedidas y las guarda en data/snapshot.json, que el build embebe en la
 * página publicada (que no puede consultar EDGAR por sí misma).
 *
 *   SEC_USER_AGENT="Tu Nombre tu@email.com" npm run snapshot                 # las 10 más grandes del S&P 500
 *   SEC_USER_AGENT="…" npm run snapshot -- --top 15                          # las 15 más grandes
 *   SEC_USER_AGENT="…" npm run snapshot -- KO JNJ NUE=72.5                   # tickers puntuales (precio a mano con =)
 *   SEC_USER_AGENT="…" npm run snapshot -- --precios precios.json            # {"NVDA": 180.2, ...}
 *   SEC_USER_AGENT="…" npm run snapshot -- --agregar XOM                     # suma al snapshot existente
 *
 * Sin tickers, baja las candidatas a mayores del S&P 500, calcula la capitalización
 * (acciones de EDGAR × precio) y se queda con las `--top` más grandes (10 por defecto).
 */
const CANDIDATAS = [
  "NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO", "TSLA", "BRK-B", "JPM", "LLY", "WMT", "ORCL", "V", "MA",
  "NFLX", "XOM", "COST", "JNJ", "PLTR", "AMD", "HD", "ABBV", "BAC", "PG", "UNH",
];

const args = process.argv.slice(2);
const opcion = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const top = Number(opcion("--top") ?? 10);
const archivoPrecios = opcion("--precios");
const agregar = args.includes("--agregar");
const pedidos = args.filter(a => !a.startsWith("--"));
const porDefecto = !pedidos.length;

const precios: Record<string, number> = archivoPrecios ? JSON.parse(await readFile(archivoPrecios, "utf8")) : {};
const lista = (porDefecto ? CANDIDATAS : pedidos).map(a => {
  const [t, p] = a.split("=");
  const ticker = t.toUpperCase();
  return { ticker, precio: p ? Number(p) : precios[ticker] };
});

const previas: Empresa[] = agregar && existsSync("data/snapshot.json") ? JSON.parse(await readFile("data/snapshot.json", "utf8")).empresas : [];
const bajadas: Empresa[] = [];
const fallidas: string[] = [];
for (const { ticker, precio } of lista) {
  try {
    const e = await empresaEdgar(ticker, precio);
    if (!(e.precio > 0)) { fallidas.push(`${ticker}: sin precio (pasalo como ${ticker}=precio o en --precios)`); continue; }
    bajadas.push(e);
    console.log(`✓ ${e.ticker.padEnd(6)} ${e.nombre} · ejercicio ${e.fuente?.cierre} · precio ${e.precio} · capitalización ${Math.round((e.precio * e.acciones) / 1000)} mil M`);
  } catch (err) {
    fallidas.push(`${ticker}: ${(err as Error).message}`);
  }
}

let elegidas = bajadas;
if (porDefecto) {
  elegidas = [...bajadas].sort((a, b) => b.precio * b.acciones - a.precio * a.acciones).slice(0, top);
  console.log(`\nLas ${elegidas.length} más grandes por capitalización: ${elegidas.map(e => e.ticker).join(", ")}`);
}

const out = new Map(previas.map(e => [e.ticker, e]));
for (const e of elegidas) out.set(e.ticker, e);
await mkdir("data", { recursive: true });
await writeFile("data/snapshot.json", JSON.stringify({
  generado: new Date().toISOString(),
  criterio: porDefecto ? `Las ${top} mayores por capitalización entre ${CANDIDATAS.length} candidatas del S&P 500` : "Tickers elegidos a mano",
  empresas: [...out.values()],
}, null, 1));
console.log(`${out.size} empresas en data/snapshot.json.`);
if (fallidas.length) console.log("\nNo se pudieron agregar:\n  " + fallidas.join("\n  "));
