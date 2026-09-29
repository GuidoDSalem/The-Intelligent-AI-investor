import type { Empresa, VeredictoId } from "./tipos.ts";
import { SUPUESTOS, type Supuestos } from "./supuestos.ts";
import { fmtPrecio, nf1, nf2, pct } from "./formato.ts";

/* ============================================================
   Utilidades puras
   ============================================================ */
export const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const hash = (s: string) => {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};
/** PRNG mulberry32: la misma semilla da la misma secuencia en Node y en el navegador. */
export const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (rnd: () => number) => {
  let u = 0;
  while (!u) u = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export function flujoDescontado(base: number, g1: number, r: number, gT: number, H: number) {
  let v = 0, f = base;
  for (let t = 1; t <= H; t++) { f *= 1 + g1; v += f / Math.pow(1 + r, t); }
  return v + (f * (1 + gT)) / (r - gT) / Math.pow(1 + r, H);
}

/* ============================================================
   CAPA FIJA — código determinístico: ratios, criterios, valuaciones
   ============================================================ */
export interface Valuacion { id: "graham" | "dcf" | "crec" | "pbjust"; nombre: string; valor: number; formula: string }
export interface Criterio { nombre: string; regla: string; valor: string; pasa: boolean | null; nota?: string | null }

export function capaDeterministica(c: Empresa, S: Supuestos = SUPUESTOS) {
  const n = c.eps.length;
  const banco = !!c.banco;
  const epsIni = avg(c.eps.slice(0, 3)), epsFin = avg(c.eps.slice(-3)), eps10 = avg(c.eps);
  const positivos = c.eps.filter(e => e > 0).length;
  const crecimiento = epsIni > 0 ? epsFin / epsIni - 1 : null;
  const cagr = epsIni > 0 && epsFin > 0 && n > 3 ? Math.pow(epsFin / epsIni, 1 / (n - 3)) - 1 : null;
  const sd = Math.sqrt(avg(c.eps.map(e => (e - eps10) ** 2)));
  const cv = eps10 > 0 ? sd / eps10 : Infinity;
  const ciclica = !!c.ciclica || (!banco && cv > 0.6 && positivos >= n - 2);

  const gananciaNeta = c.eps[n - 1] * c.acciones;
  const vlpa = c.patrimonio / c.acciones;
  const roe = gananciaNeta / c.patrimonio;
  const margenNeto = gananciaNeta / c.ventas;
  const margenOperativo = has(c.ebit) ? c.ebit / c.ventas : null;
  const liquidez = has(c.activoCorriente) && has(c.pasivoCorriente) && c.pasivoCorriente > 0 ? c.activoCorriente / c.pasivoCorriente : null;
  const capitalTrabajo = liquidez !== null ? c.activoCorriente! - c.pasivoCorriente! : null;
  const ebitda = has(c.ebit) && has(c.depreciaciones) ? c.ebit + c.depreciaciones : has(c.ebit) ? c.ebit : null;
  const deudaNeta = has(c.deudaTotal) && has(c.caja) ? c.deudaTotal - c.caja : null;
  const deudaNetaEbitda = ebitda && ebitda > 0 && deudaNeta !== null ? deudaNeta / ebitda : null;
  const sinDeuda = has(c.deudaTotal) && c.deudaTotal <= 0;
  const cobertura = has(c.ebit) && has(c.intereses) && c.intereses > 0 ? c.ebit / c.intereses : null;
  const fcf = has(c.flujoOperativo) && has(c.capex) ? c.flujoOperativo - c.capex : null;
  const conversion = fcf !== null && gananciaNeta > 0 ? fcf / gananciaNeta : null;

  const capitalizacion = c.precio * c.acciones;
  const pe = epsFin > 0 ? c.precio / epsFin : null;
  const pb = vlpa > 0 ? c.precio / vlpa : null;
  const fcfYield = fcf !== null ? fcf / capitalizacion : null;
  const ev = deudaNeta !== null ? capitalizacion + deudaNeta : null;
  const evEbitda = ev !== null && ebitda && ebitda > 0 ? ev / ebitda : null;

  // Base de valuación (por acción)
  const epsBase = ciclica ? eps10 : epsFin;
  const g1 = ciclica ? 0.02 : clamp(cagr ?? 0, S.crecimientoLimites[0], S.crecimientoLimites[1]);
  const fcfpa = fcf !== null ? fcf / c.acciones : null;
  const baseFlujo = banco ? null : ciclica ? eps10 * clamp(conversion ?? 0.8, 0.3, 1.1) : fcfpa;
  const rMed = avg(S.tasa), gTMed = avg(S.crecimientoTerminal);

  const valuaciones: Valuacion[] = [];
  if (epsBase > 0 && vlpa > 0)
    valuaciones.push({ id: "graham", nombre: "Número de Graham", valor: Math.sqrt(22.5 * epsBase * vlpa), formula: `√(22,5 × ${nf2.format(epsBase)} × ${nf2.format(vlpa)})` });
  if (banco) {
    const pbJust = (roe - gTMed) / (rMed - gTMed);
    valuaciones.push({ id: "pbjust", nombre: "P/B justificado (financiera)", valor: Math.max(0, pbJust * vlpa), formula: "VLPA × (ROE − g) / (r − g)" });
  } else if (baseFlujo !== null) {
    valuaciones.push({ id: "dcf", nombre: "Flujo descontado (caso base)", valor: Math.max(0, flujoDescontado(baseFlujo, g1, rMed, gTMed, S.horizonte)), formula: `FCF ${nf2.format(baseFlujo)}, g ${nf1.format(g1 * 100)} % × ${S.horizonte} años, r ${nf1.format(rMed * 100)} %` });
  }
  if (epsBase > 0) {
    const g = clamp((ciclica ? 0.02 : cagr ?? 0) * 100, 0, 15);
    valuaciones.push({ id: "crec", nombre: "Fórmula de crecimiento", valor: epsBase * (8.5 + 2 * g), formula: `${nf2.format(epsBase)} × (8,5 + 2 × ${nf1.format(g)})` });
  }

  // Criterios del inversor defensivo
  const divDisp = c.aniosDividendosDisponibles;
  const divTodos = divDisp !== undefined && c.aniosDividendos >= divDisp && divDisp >= 10;
  const criterios: Criterio[] = [
    { nombre: "Tamaño adecuado", regla: `Ventas ≥ ${S.ventasMinimas.toLocaleString("es-AR")} M`, valor: `${Math.round(c.ventas).toLocaleString("es-AR")} M`, pasa: c.ventas >= S.ventasMinimas },
    { nombre: "Liquidez corriente", regla: "≥ 2", valor: liquidez === null ? "—" : nf2.format(liquidez), pasa: liquidez === null ? null : liquidez >= 2, nota: banco ? "No aplica a financieras" : liquidez === null ? "Sin dato" : null },
    { nombre: "Deuda LP ≤ capital de trabajo", regla: "Deuda LP ≤ AC − PC", valor: capitalTrabajo === null || !has(c.deudaLP) ? "—" : `${Math.round(c.deudaLP).toLocaleString("es-AR")} vs ${Math.round(capitalTrabajo).toLocaleString("es-AR")}`, pasa: capitalTrabajo === null || !has(c.deudaLP) ? null : c.deudaLP <= capitalTrabajo, nota: banco ? "No aplica a financieras" : null },
    { nombre: "Ganancias positivas", regla: "10 de 10 años", valor: `${positivos} de ${n}`, pasa: positivos === n && n >= 10, nota: n < 10 ? `Sólo hay ${n} años de datos` : null },
    { nombre: "Dividendos ininterrumpidos", regla: "≥ 20 años", valor: `${c.aniosDividendos} años`, pasa: c.aniosDividendos >= 20 || divTodos, nota: divTodos && c.aniosDividendos < 20 ? `Pagó en los ${divDisp} años con datos disponibles` : null },
    { nombre: "Crecimiento de EPS", regla: "≥ +33 % (prom. 3 años)", valor: crecimiento === null ? "—" : `${crecimiento >= 0 ? "+" : ""}${Math.round(crecimiento * 100)} %`, pasa: crecimiento === null ? false : crecimiento >= 0.33 },
    { nombre: "P/E moderado", regla: "≤ 15 (EPS prom. 3 años)", valor: pe === null ? "neg." : nf1.format(pe), pasa: pe !== null && pe <= 15 },
    { nombre: "Precio vs. libros", regla: "P/B ≤ 1,5 o P/E × P/B ≤ 22,5", valor: pb === null ? "patrimonio neg." : pe === null ? nf2.format(pb) : `${nf2.format(pb)} · ${nf1.format(pe * pb)}`, pasa: pb !== null && (pb <= 1.5 || (pe !== null && pe * pb <= 22.5)) },
  ];

  return {
    anios: n, banco, ciclica, epsIni, epsFin, eps10, positivos, crecimiento, cagr, cv, gananciaNeta, vlpa, roe, margenNeto, margenOperativo,
    liquidez, capitalTrabajo, ebitda, deudaNeta, deudaNetaEbitda, sinDeuda, cobertura, fcf, fcfpa, conversion,
    capitalizacion, pe, pb, fcfYield, ev, evEbitda, epsBase, g1, baseFlujo, valuaciones, criterios,
  };
}
export type Determinista = ReturnType<typeof capaDeterministica>;

/* ============================================================
   SISTEMA 1 — rápido y probabilístico
   Monte Carlo sobre la valuación + señales de calidad en log-odds.
   Semilla fija por empresa: el mismo dato da siempre la misma salida.
   ============================================================ */
export const VEREDICTOS: Record<VeredictoId, { txt: string; corto: string }> = {
  comprar: { txt: "Comprar con margen", corto: "Negocio sano y precio con margen de seguridad." },
  justo: { txt: "Precio justo", corto: "El precio ya refleja lo que vale: sin margen, conviene esperar." },
  cara: { txt: "Cara", corto: "El precio supone más de lo que el negocio viene mostrando." },
  evitar: { txt: "Evitar", corto: "Riesgo financiero alto: un precio bajo no compensa la fragilidad." },
};

export interface Senal { nombre: string; valor: number; texto: string }

export function senalesCalidad(d: Determinista): Senal[] {
  const s: Senal[] = [];
  const add = (nombre: string, valor: number, texto: string) => s.push({ nombre, valor: clamp(valor, -1.5, 1.5), texto });
  add("Rentabilidad sobre patrimonio", d.vlpa > 0 ? (d.roe - 0.1) * 12 : -1.5, d.vlpa > 0 ? `${nf1.format(d.roe * 100)} %` : "patrimonio negativo");
  add("Consistencia", (d.positivos - (d.anios - 1)) * 0.6, `${d.positivos}/${d.anios} años con ganancia`);
  add("Crecimiento", d.ciclica ? 0 : d.cagr === null ? -1 : clamp(d.cagr * 10, -1, 1), d.ciclica ? "cíclico, no cuenta" : d.cagr === null ? "sin base" : `${nf1.format(d.cagr * 100)} %/año`);
  add("Estabilidad", Number.isFinite(d.cv) ? clamp(0.6 - d.cv * 2.5, -1.5, 0.6) : -1.5, Number.isFinite(d.cv) ? `variación ${nf2.format(d.cv)}` : "muy inestable");
  if (!d.banco) {
    add("Liquidez", d.liquidez === null ? 0 : clamp((d.liquidez - 1.5) * 0.8, -1, 1), d.liquidez === null ? "sin dato" : nf2.format(d.liquidez));
    add("Endeudamiento", d.deudaNetaEbitda === null ? 0 : (2 - d.deudaNetaEbitda) * 0.5, d.deudaNetaEbitda === null ? "sin dato" : `${nf1.format(d.deudaNetaEbitda)}× EBITDA`);
    add("Cobertura de intereses", d.cobertura === null ? (d.sinDeuda ? 0.5 : 0) : Math.log(d.cobertura / 5) * 0.6, d.cobertura === null ? (d.sinDeuda ? "sin deuda" : "sin dato") : `${nf1.format(d.cobertura)}×`);
    add("Caja vs. ganancia", d.conversion === null ? -1 : clamp((d.conversion - 0.8) * 2, -1, 1), d.conversion === null ? (d.fcf === null ? "sin dato" : "FCF o ganancia negativos") : nf2.format(d.conversion));
  }
  return s;
}

export function sistema1(c: Empresa, d: Determinista, S: Supuestos = SUPUESTOS) {
  const rnd = rng(hash(c.ticker + JSON.stringify(c.eps) + c.precio + S.version));
  const N = S.simulaciones, vals = new Float64Array(N);
  const sigma = clamp(d.cv * 0.5, 0.08, 0.45);
  for (let i = 0; i < N; i++) {
    const r = S.tasa[0] + rnd() * (S.tasa[1] - S.tasa[0]);
    const gT = S.crecimientoTerminal[0] + rnd() * (S.crecimientoTerminal[1] - S.crecimientoTerminal[0]);
    let v: number;
    if (d.banco) {
      const roe = d.roe + gauss(rnd) * 0.02;
      v = (d.vlpa * (roe - gT)) / (r - gT);
    } else if (d.baseFlujo === null || d.baseFlujo <= 0) {
      v = 0;
    } else {
      const base = d.baseFlujo * Math.exp(gauss(rnd) * sigma - (sigma * sigma) / 2);
      const g1 = clamp(d.g1 + gauss(rnd) * 0.03, -0.1, 0.22);
      v = flujoDescontado(base, g1, r, gT, S.horizonte);
    }
    vals[i] = Math.max(0, v);
  }
  vals.sort();
  const q = (p: number) => vals[Math.min(N - 1, Math.floor(p * N))];
  const p10 = q(0.1), p50 = q(0.5), p90 = q(0.9);
  let sobre = 0, conMargen = 0;
  for (const v of vals) { if (v > c.precio) sobre++; if (v >= S.umbralComprar * c.precio) conMargen++; }
  const pSobre = sobre / N, pMargen = conMargen / N;
  const ratio = p50 / c.precio;

  const senales = senalesCalidad(d);
  const calidad = sigmoid(0.55 * senales.reduce((s, x) => s + x.valor, 0) + (d.banco ? 0.4 : 0) + (Math.min(c.aniosDividendos, 20) / 20) * 0.4 - 1.2);

  const fragilidad: string[] = [];
  if (d.cobertura !== null && d.cobertura < 3) fragilidad.push(`la ganancia operativa cubre sólo ${nf1.format(d.cobertura)} veces los intereses`);
  if (d.deudaNetaEbitda !== null && d.deudaNetaEbitda > 4) fragilidad.push(`la deuda neta es ${nf1.format(d.deudaNetaEbitda)} veces el EBITDA`);
  if (!d.banco && d.ebitda !== null && d.ebitda <= 0 && (d.deudaNeta ?? 0) > 0) fragilidad.push("tiene deuda neta y EBITDA negativo");
  if (d.positivos < c.eps.length - 3) fragilidad.push(`tuvo pérdidas en ${c.eps.length - d.positivos} de los últimos ${c.eps.length} años`);
  if (d.banco && d.roe < 0.06) fragilidad.push(`el ROE de ${nf1.format(d.roe * 100)} % no cubre el costo de capital`);
  if (d.vlpa <= 0) fragilidad.push("el patrimonio es negativo");

  let veredicto: VeredictoId, confianza: number;
  if (fragilidad.length) {
    veredicto = "evitar";
    confianza = Math.min(0.95, 0.55 + 0.2 * fragilidad.length);
  } else {
    veredicto = ratio >= S.umbralComprar && pMargen >= 0.5 ? "comprar" : ratio >= S.umbralCara ? "justo" : "cara";
    const dist = Math.min(Math.abs(Math.log(ratio / S.umbralComprar)), Math.abs(Math.log(ratio / S.umbralCara)));
    const dispersion = p10 > 0 ? Math.log(p90 / p10) : 3;
    confianza = clamp(dist / 0.2, 0, 1) * clamp(1.25 - dispersion / 1.6, 0.35, 1);
  }

  // ¿Hay que despertar al Sistema 2?
  const escalar: string[] = [];
  if (confianza < S.confianzaMinima) escalar.push(`Confianza baja (${pct(confianza)}): el valor mediano quedó a ${nf2.format(ratio)} veces el precio, cerca de un umbral.`);
  if (calidad >= 0.8 && veredicto === "cara") escalar.push("Choque de señales: el negocio es de alta calidad, pero los criterios clásicos de Graham castigan su precio. Hay que juzgar si el crecimiento lo justifica.");
  if (calidad < 0.35 && veredicto === "comprar") escalar.push("Parece barata pero la calidad es baja: puede ser una trampa de valor.");
  if (d.ciclica && d.fcfpa && d.fcfpa > 0 && !fragilidad.length) {
    const ingenuo = flujoDescontado(d.fcfpa, clamp(d.cagr ?? 0, S.crecimientoLimites[0], S.crecimientoLimites[1]), avg(S.tasa), avg(S.crecimientoTerminal), S.horizonte) / c.precio;
    const vIng: VeredictoId = ingenuo >= S.umbralComprar ? "comprar" : ingenuo >= S.umbralCara ? "justo" : "cara";
    if (vIng !== veredicto) escalar.push(`Empresa cíclica: con las ganancias recientes parecería “${VEREDICTOS[vIng].txt}”, pero normalizando el ciclo da “${VEREDICTOS[veredicto].txt}”. Hay que decidir en qué parte del ciclo está.`);
  }

  return { vals, p10, p50, p90, pSobre, pMargen, ratio, senales, calidad, fragilidad, veredicto, confianza, escalar };
}
export type Sistema1 = ReturnType<typeof sistema1>;

export function justificar(c: Empresa, d: Determinista, s1: Sistema1, S: Supuestos = SUPUESTOS): string[] {
  const out: string[] = [];
  if (s1.fragilidad.length) out.push(`Señal de fragilidad: ${s1.fragilidad.join("; ")}.`);
  out.push(`Cotiza a ${fmtPrecio(c.precio)}. El valor mediano estimado es ${fmtPrecio(s1.p50)} y el rango probable va de ${fmtPrecio(s1.p10)} a ${fmtPrecio(s1.p90)} (${S.simulaciones.toLocaleString("es-AR")} simulaciones).`);
  out.push(`Probabilidad de que valga más que el precio: ${pct(s1.pSobre)}. Con un margen de seguridad de un tercio: ${pct(s1.pMargen)}.`);
  const aplican = d.criterios.filter(k => k.pasa !== null), fallan = aplican.filter(k => !k.pasa);
  out.push(`Cumple ${aplican.length - fallan.length} de ${aplican.length} criterios de Graham${fallan.length ? `; falla en ${fallan.map(k => k.nombre.toLowerCase()).join(", ")}` : ""}.`);
  const ord = [...s1.senales].sort((a, b) => b.valor - a.valor);
  out.push(`Calidad del negocio ${pct(s1.calidad)}: lo más fuerte es ${ord[0].nombre.toLowerCase()} (${ord[0].texto}); lo más débil, ${ord.at(-1)!.nombre.toLowerCase()} (${ord.at(-1)!.texto}).`);
  if (d.ciclica) out.push(`Es cíclica: el motor valúa con la ganancia promedio de ${c.eps.length} años (${nf2.format(d.eps10)}) en lugar de la reciente (${nf2.format(d.epsFin)}).`);
  if (d.banco) out.push("Es una financiera: la deuda es su materia prima, así que liquidez y endeudamiento no aplican; se valúa por P/B justificado según su ROE.");
  return out;
}

export interface Analisis {
  c: Empresa;
  d: Determinista;
  s1: Sistema1;
  porque: string[];
  tiempos: { d: number; s1: number };
}

export function analizar(c: Empresa, S: Supuestos = SUPUESTOS): Analisis {
  const t0 = performance.now();
  const d = capaDeterministica(c, S);
  const t1 = performance.now();
  const s1 = sistema1(c, d, S);
  const t2 = performance.now();
  return { c, d, s1, porque: justificar(c, d, s1, S), tiempos: { d: t1 - t0, s1: t2 - t1 } };
}

/** Chequeo mínimo de datos antes de analizar. Devuelve el error en texto o null. */
export function validarEmpresa(o: Partial<Empresa>): string | null {
  const req = ["ticker", "nombre", "sector", "precio", "acciones", "eps", "ventas", "patrimonio", "aniosDividendos"] as const;
  for (const k of req) if (o[k] === undefined || o[k] === null || (o[k] as unknown) === "") return `Falta el campo “${k}”.`;
  if (!Array.isArray(o.eps) || o.eps.length < 4 || !o.eps.every(Number.isFinite)) return "“eps” tiene que ser una lista de al menos 4 números (idealmente 10).";
  for (const k of ["precio", "acciones", "ventas"] as const) if (!(Number(o[k]) > 0)) return `“${k}” tiene que ser un número mayor que cero.`;
  if (!Number.isFinite(o.patrimonio)) return "“patrimonio” tiene que ser un número.";
  return null;
}
