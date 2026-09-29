import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { candidatasPorTamano, type Cotizacion, cotizacion, empresaEdgar } from "../src/edgar/cliente.ts";
import type { Empresa } from "../src/engine/tipos.ts";

/**
 * Baja de EDGAR las empresas pedidas y las guarda en data/snapshot.json, que el build embebe en la
 * página publicada (que no puede consultar EDGAR por sí misma).
 *
 *   SEC_USER_AGENT="Tu Nombre tu@email.com" npm run snapshot     # las 100 mayores; se muestran las 10 primeras
 *   … npm run snapshot -- --top 15 --incluir 200                  # mostrar 15, guardar 200 para buscar
 *   … npm run snapshot -- --precios precios.json                  # {"NVDA": 180.2, …} en vez de Yahoo
 *   … npm run snapshot -- KO JNJ NUE=72.5 --agregar               # tickers puntuales (precio a mano con =)
 *
 * Sin tickers, las candidatas salen de EDGAR (frames de acciones en circulación y valor de mercado de todas
 * las empresas que presentan 10-K), se ordenan por acciones × precio y se guardan las `--incluir` más grandes.
 * Las `--top` primeras quedan como destacadas: son las que la página muestra al abrir.
 */
const args = process.argv.slice(2);
const opcion = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const top = Number(opcion("--top") ?? 10);
const incluir = Math.max(top, Number(opcion("--incluir") ?? 100));
const archivoPrecios = opcion("--precios");
const agregar = args.includes("--agregar");
const pedidos = args.filter(a => !a.startsWith("--"));
const precios: Record<string, number> = archivoPrecios ? JSON.parse(await readFile(archivoPrecios, "utf8")) : {};

const previo = agregar && existsSync("data/snapshot.json") ? JSON.parse(await readFile("data/snapshot.json", "utf8")) : null;
const fallidas: string[] = [];
const cap = (e: Empresa) => e.precio * e.acciones;

async function bajar(ticker: string, precio?: number | Cotizacion): Promise<Empresa | null> {
  try {
    const e = await empresaEdgar(ticker, precio);
    if (!(e.precio > 0)) { fallidas.push(`${ticker}: sin precio (pasalo como ${ticker}=precio o en --precios)`); return null; }
    console.log(`✓ ${e.ticker.padEnd(6)} ${e.nombre.slice(0, 34).padEnd(34)} ejercicio ${e.fuente?.cierre} · $${e.precio} · ${Math.round(cap(e) / 1000)} mil M`);
    return e;
  } catch (err) {
    fallidas.push(`${ticker}: ${(err as Error).message}`);
    return null;
  }
}

let empresas: Empresa[] = [];
let destacadas: string[] = [];
let criterio: string;

if (pedidos.length) {
  for (const a of pedidos) {
    const [t, p] = a.split("=");
    const e = await bajar(t.toUpperCase(), p ? Number(p) : precios[t.toUpperCase()]);
    if (e) empresas.push(e);
  }
  criterio = "Tickers elegidos a mano";
} else {
  // 1. Preselección con datos de portada de todas las empresas (una sola consulta por trimestre).
  const cands = await candidatasPorTamano();
  // Unión de dos criterios: el public float (falta en algunas, como AMD) y la cantidad de acciones.
  const porFlotante = [...cands].sort((a, b) => (b.flotante ?? 0) - (a.flotante ?? 0)).slice(0, incluir + 80);
  const porAcciones = [...cands].sort((a, b) => (b.acciones ?? 0) - (a.acciones ?? 0)).slice(0, incluir * 3);
  const preseleccion = [...new Map([...porFlotante, ...porAcciones].map(c => [c.cik, c])).values()];
  console.log(`${cands.length} empresas con datos de portada; consulto precios de ${preseleccion.length}…`);

  // 2. Capitalización preliminar = acciones de portada × precio (el public float es viejo y a veces está mal escalado).
  const prelim: { ticker: string; cot?: number | Cotizacion; valor: number }[] = [];
  for (const c of preseleccion) {
    const manual = precios[c.ticker] as number | undefined;
    const cot: number | Cotizacion | null = manual ?? await cotizacion(c.ticker);
    const p = typeof cot === "number" ? cot : cot?.precio;
    const valor = p && c.acciones ? p * c.acciones : c.flotante ?? 0;
    prelim.push({ ticker: c.ticker, cot: cot ?? undefined, valor });
  }
  prelim.sort((a, b) => b.valor - a.valor);

  // 3. Datos completos de EDGAR, en orden, hasta juntar `incluir` + 20 empresas; con la capitalización real
  //    (acciones del 10-K × precio) se descartan las que se colaron por datos de portada mal escalados.
  for (const c of prelim) {
    if (empresas.length >= incluir + 20) break;
    const e = await bajar(c.ticker, c.cot);
    if (e) empresas.push(e);
  }
  empresas = empresas.sort((a, b) => cap(b) - cap(a)).slice(0, incluir);
  destacadas = empresas.slice(0, top).map(e => e.ticker);
  criterio = `Las ${empresas.length} mayores empresas de EE. UU. que presentan 10-K, por acciones × precio; se muestran las ${top} primeras`;
  console.log(`\nDestacadas (las ${top} mayores): ${destacadas.join(", ")}`);
}

if (previo) {
  const nuevas = new Set(empresas.map(e => e.ticker));
  empresas = [...(previo.empresas as Empresa[]).filter(e => !nuevas.has(e.ticker)), ...empresas];
  destacadas = previo.destacadas ?? [];
  criterio = previo.criterio ?? criterio;
}

await mkdir("data", { recursive: true });
await writeFile("data/snapshot.json", JSON.stringify({ generado: new Date().toISOString(), criterio, destacadas, empresas }));
console.log(`${empresas.length} empresas en data/snapshot.json.`);
if (fallidas.length) console.log("\nNo se pudieron agregar:\n  " + fallidas.join("\n  "));
