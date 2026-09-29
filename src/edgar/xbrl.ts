import type { Empresa } from "../engine/tipos.ts";

/**
 * Convierte las respuestas de SEC EDGAR (companyfacts + submissions) en una `Empresa`.
 * Función pura: no hace red, así se puede testear con fixtures.
 *
 * - companyfacts: https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 * - submissions:  https://data.sec.gov/submissions/CIK##########.json
 */

export interface Hecho {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}
export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { label?: string; units: Record<string, Hecho[]> }>>;
}
export interface Submissions {
  cik: string;
  name: string;
  sic?: string;
  sicDescription?: string;
  tickers?: string[];
  fiscalYearEnd?: string;
  filings?: { recent?: { form?: string[] } };
}

/** "extranjera": presenta 20-F/40-F; "sin10k": local pero todavía sin 10-K (p. ej. una holding nueva); "local": presenta 10-K. */
export function tipoEmisor(sub: Submissions): "local" | "extranjera" | "sin10k" {
  const f = sub.filings?.recent?.form;
  if (!f?.length) return "local";
  if (f.some(x => x.startsWith("10-K"))) return "local";
  if (f.some(x => x === "20-F" || x === "40-F" || x === "20-F/A" || x === "40-F/A")) return "extranjera";
  return "sin10k";
}

const esAnual = (form: string) => /^(10-K|10-KT)(\/A)?$/.test(form);
const dias = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
/** Año del ejercicio: los de 52/53 semanas pueden cerrar los primeros días de enero (J&J cerró el 1/1/2017 su 2016). */
export const anioFiscal = (cierre: string) => new Date(Date.parse(cierre) - 7 * 86400000).getUTCFullYear();

/** Hechos de varias etiquetas, en orden de preferencia: por período gana la primera etiqueta que lo tenga. */
function hechos(cf: CompanyFacts, etiquetas: string[], unidad = "USD", taxonomia = "us-gaap"): Hecho[] {
  const porPeriodo = new Map<string, Hecho[]>();
  for (const et of etiquetas) {
    const arr = cf.facts[taxonomia]?.[et]?.units?.[unidad];
    if (!arr) continue;
    const nuevos = new Map<string, Hecho[]>();
    for (const h of arr) {
      if (!esAnual(h.form)) continue;
      const k = (h.start ?? "") + "|" + h.end;
      if (porPeriodo.has(k)) continue;
      if (!nuevos.has(k)) nuevos.set(k, []);
      nuevos.get(k)!.push(h);
    }
    for (const [k, v] of nuevos) porPeriodo.set(k, v);
  }
  return [...porPeriodo.values()].flat();
}

/** Valores anuales (duración de ~1 año) por fecha de cierre, quedándose con el último presentado. */
function anuales(hs: Hecho[]): Map<string, Hecho> {
  const m = new Map<string, Hecho>();
  for (const h of hs) {
    if (!h.start) continue;
    const d = dias(h.start, h.end);
    if (d < 350 || d > 380) continue;
    const prev = m.get(h.end);
    if (!prev || h.filed > prev.filed) m.set(h.end, h);
  }
  return m;
}

/** Valores de balance (instantáneos) por fecha, quedándose con el último presentado. */
function instantes(hs: Hecho[]): Map<string, Hecho> {
  const m = new Map<string, Hecho>();
  for (const h of hs) {
    if (h.start) continue;
    const prev = m.get(h.end);
    if (!prev || h.filed > prev.filed) m.set(h.end, h);
  }
  return m;
}

const SPLITS = [1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 30, 40, 50];
function factorSplit(r: number, tolerancia = 0.03): number | null {
  const inv = r < 1;
  const x = inv ? 1 / r : r;
  if (x < 1.4) return null;
  const s = SPLITS.find(k => Math.abs(x - k) / k < tolerancia);
  return s ? (inv ? 1 / s : s) : null;
}

/**
 * EPS anual ajustado por splits. Un 10-K repite los EPS de años anteriores; si después de un split
 * la empresa los re-expresa, el mismo período aparece con dos valores cuya razón es un número de split.
 * Esos eventos se aplican a los períodos cuyo último valor se presentó antes de la re-expresión.
 */
export function epsAjustado(hs: Hecho[]): { porCierre: Map<string, number>; splits: { factor: number; desde: string }[] } {
  const duracion = hs.filter(h => h.start && dias(h.start, h.end) >= 350 && dias(h.start, h.end) <= 380);
  const porCierre = new Map<string, Hecho[]>();
  for (const h of duracion) {
    if (!porCierre.has(h.end)) porCierre.set(h.end, []);
    porCierre.get(h.end)!.push(h);
  }
  const eventos = new Map<string, { factor: number; desde: string }>();
  for (const lista of porCierre.values()) {
    lista.sort((a, b) => a.filed.localeCompare(b.filed));
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1], b = lista[i];
      if (!a.val || !b.val) continue;
      const f = factorSplit(a.val / b.val);
      if (f && !eventos.has(b.filed)) eventos.set(b.filed, { factor: f, desde: b.filed });
    }
  }
  const splits = [...eventos.values()].sort((a, b) => a.desde.localeCompare(b.desde));
  const ultimo = anuales(duracion);
  const out = new Map<string, number>();
  for (const [cierre, h] of ultimo) {
    let v = h.val;
    for (const s of splits) if (h.filed < s.desde) v /= s.factor;
    out.set(cierre, v);
  }
  return { porCierre: out, splits };
}

/** Clasificación por código SIC. */
/** Sectores al estilo GICS (los del mapa del S&P 500) a partir del código SIC de EDGAR. */
export const SECTORES = ["Tecnología", "Comunicaciones", "Salud", "Finanzas", "Consumo discrecional", "Consumo básico", "Industria", "Energía", "Servicios públicos", "Materiales", "Inmobiliario"] as const;

const RANGOS_SECTOR: [number, number, (typeof SECTORES)[number]][] = [
  // Orden importa: el primer rango que contiene al SIC gana.
  [6324, 6324, "Salud"], [7320, 7329, "Finanzas"], [3559, 3559, "Tecnología"], [3822, 3822, "Industria"], [3600, 3600, "Industria"],
  [6500, 6553, "Inmobiliario"], [6798, 6798, "Inmobiliario"], [6000, 6799, "Finanzas"],
  [1300, 1399, "Energía"], [2900, 2999, "Energía"], [4610, 4619, "Energía"], [4922, 4923, "Energía"],
  [4900, 4999, "Servicios públicos"],
  [2830, 2836, "Salud"], [3840, 3851, "Salud"], [8000, 8099, "Salud"], [5047, 5047, "Salud"], [5122, 5122, "Salud"], [8731, 8731, "Salud"],
  [3630, 3639, "Consumo discrecional"],
  [3570, 3579, "Tecnología"], [3600, 3699, "Tecnología"], [3820, 3829, "Tecnología"], [3570, 3579, "Tecnología"], [7371, 7379, "Tecnología"],
  [7370, 7370, "Comunicaciones"], [4800, 4899, "Comunicaciones"], [7810, 7849, "Comunicaciones"], [2710, 2799, "Comunicaciones"],
  [2000, 2199, "Consumo básico"], [2840, 2844, "Consumo básico"], [5140, 5149, "Consumo básico"], [5180, 5182, "Consumo básico"],
  [5400, 5499, "Consumo básico"], [5310, 5399, "Consumo básico"], [5912, 5912, "Consumo básico"],
  [1000, 1299, "Materiales"], [1400, 1499, "Materiales"], [2400, 2499, "Materiales"], [2600, 2699, "Materiales"], [2800, 2829, "Materiales"],
  [2850, 2899, "Materiales"], [3000, 3099, "Materiales"], [3200, 3399, "Materiales"],
  [2200, 2399, "Consumo discrecional"], [2500, 2599, "Consumo discrecional"], [3140, 3149, "Consumo discrecional"], [3710, 3716, "Consumo discrecional"],
  [3940, 3949, "Consumo discrecional"], [4700, 4799, "Consumo discrecional"], [5200, 5999, "Consumo discrecional"], [7000, 7099, "Consumo discrecional"],
  [7900, 7999, "Consumo discrecional"], [8200, 8299, "Consumo discrecional"],
  [1500, 1799, "Industria"], [3400, 3569, "Industria"], [3580, 3599, "Industria"], [3700, 3819, "Industria"], [4000, 4599, "Industria"],
  [5000, 5199, "Industria"], [7350, 7359, "Industria"], [7380, 7389, "Industria"], [8700, 8799, "Industria"],
];

/** Casos conocidos donde el SIC y GICS no coinciden (medios de pago, ciencias de la vida, etc.). */
const SECTOR_POR_TICKER: Record<string, string> = {
  V: "Finanzas", MA: "Finanzas", PYPL: "Finanzas", FI: "Finanzas", MCO: "Finanzas",
  TMO: "Salud", DHR: "Salud", A: "Salud", IQV: "Salud",
  ACN: "Tecnología", GLW: "Tecnología", ADP: "Industria", PAYX: "Industria", HWM: "Industria",
  DASH: "Consumo discrecional", ABNB: "Consumo discrecional",
};

export function sectorPorSic(sic: number | null, ticker?: string): string {
  if (ticker && SECTOR_POR_TICKER[ticker]) return SECTOR_POR_TICKER[ticker];
  if (sic === null || !Number.isFinite(sic)) return "Otros";
  return RANGOS_SECTOR.find(([a, b]) => sic >= a && sic <= b)?.[2] ?? "Otros";
}

/** Clasificación por código SIC. */
export function clasificarSic(sic: number | null, ticker?: string) {
  if (sic === null || !Number.isFinite(sic)) return { sector: sectorPorSic(null, ticker), financiera: false, ciclica: false };
  const financiera = sic >= 6000 && sic < 6500;
  const ciclica =
    (sic >= 1000 && sic < 1500) || (sic >= 2800 && sic < 2830) || (sic >= 2900 && sic < 3000) ||
    (sic >= 3310 && sic < 3400) || (sic >= 3710 && sic < 3720) || (sic >= 4400 && sic < 4500) || (sic >= 1520 && sic < 1540);
  return { sector: sectorPorSic(sic, ticker), financiera, ciclica };
}

/** "COCA COLA CO" → "Coca Cola Co" */
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s\-/&.(])([a-z])/g, (_m, sep: string, l: string) => sep + l.toUpperCase());

const ETIQ = {
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  ventas: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "ElectricUtilityRevenue", "InterestAndDividendIncomeOperating", "InterestAndFeeIncomeLoansAndLeases"],
  // Primero la ganancia de los accionistas comunes (sin preferidas ni minoritarios), que es la que va con la EPS.
  gananciaNeta: ["NetIncomeLossAvailableToCommonStockholdersDiluted", "NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLoss", "ProfitLoss"],
  patrimonio: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  activoCorriente: ["AssetsCurrent"],
  pasivoCorriente: ["LiabilitiesCurrent"],
  caja: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
  deudaLP: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtAndFinanceLeaseLiabilitiesNoncurrent"],
  deudaLPTotal: ["LongTermDebt", "LongTermNotesPayable", "LongTermNotesAndLoans"],
  deudaTotal: ["DebtLongtermAndShorttermCombinedAmount"],
  deudaCorriente: ["DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  deudaLPCorriente: ["LongTermDebtCurrent"],
  cortoPlazo: ["ShortTermBorrowings", "CommercialPaper"],
  ebit: ["OperatingIncomeLoss"],
  resultadoAntesImpuestos: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  depreciaciones: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"],
  depreciacion: ["Depreciation"],
  amortizacion: ["AmortizationOfIntangibleAssets"],
  intereses: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt", "InterestPaidNet"],
  flujoOperativo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsForCapitalImprovements"],
  dividendosPA: ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
  dividendosPagados: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  accionesPromedio: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"],
};

export class ErrorEdgar extends Error {}

/**
 * Ingresos anuales recientes, en millones, de cualquier formulario: el último ejercicio de un 10-K o el último
 * trimestre de un 10-Q × 4. Sirve para validar capitalizaciones que no salen del análisis completo.
 */
export function ingresosRecientes(cf: CompanyFacts): number | null {
  let mejor: { end: string; val: number } | null = null;
  for (const et of ETIQ.ventas) {
    for (const h of cf.facts["us-gaap"]?.[et]?.units?.USD ?? []) {
      if (!h.start) continue;
      const d = dias(h.start, h.end);
      const anual = d >= 350 && d <= 380 ? h.val : d >= 80 && d <= 100 ? h.val * 4 : null;
      if (anual !== null && anual > 0 && (!mejor || h.end > mejor.end)) mejor = { end: h.end, val: anual };
    }
  }
  return mejor ? mejor.val / 1e6 : null;
}

export function empresaDesdeEdgar(cf: CompanyFacts, sub: Submissions, ticker: string, precio: number | null, maxAnios = 10): Empresa & { precio: number } {
  const avisos: string[] = [];
  const tipo = tipoEmisor(sub);
  if (tipo === "extranjera") throw new ErrorEdgar("Es una emisora extranjera (presenta 20-F/40-F, no 10-K): no forma parte del S&P 500 y el motor sólo lee 10-K. Cargala a mano.");
  if (tipo === "sin10k") throw new ErrorEdgar(`${sub.name} todavía no presentó un 10-K anual (es una entidad nueva o cambió de estructura societaria, como ExxonMobil en 2026). Cargala a mano con los datos del último balance anual.`);
  if (!cf.facts["us-gaap"]) {
    throw new ErrorEdgar(cf.facts["ifrs-full"]
      ? "Esta empresa reporta en IFRS (formulario 20-F/40-F). Por ahora el motor sólo lee estados en us-gaap: cargala a mano."
      : "EDGAR no tiene datos contables estructurados (XBRL) para esta empresa.");
  }

  // EPS por ejercicio, ajustado por splits
  let epsH = hechos(cf, ETIQ.eps, "USD/shares");
  const CLASES = "Puede que reporte la ganancia por clase de acción (como Visa o Berkshire Hathaway): cargala a mano.";
  if (!epsH.length) {
    // Algunas empresas (Airbnb, Constellation Brands) no etiquetan la EPS sin dimensiones: se calcula como
    // ganancia de los accionistas comunes / acciones promedio diluidas, ejercicio por ejercicio.
    const gnA = anuales(hechos(cf, ETIQ.gananciaNeta));
    const accA = anuales(hechos(cf, ETIQ.accionesPromedio, "shares"));
    const calculada: Hecho[] = [...gnA].flatMap(([end, h]) => { const a = accA.get(end); return a && a.val > 0 ? [{ ...h, val: h.val / a.val }] : []; });
    if (calculada.length >= 4) {
      epsH = calculada;
      avisos.push("EDGAR no trae la EPS sin desagregar: se calculó como ganancia de los accionistas comunes / acciones promedio diluidas.");
    }
  }
  if (!epsH.length) {
    const soloTrimestral = ETIQ.eps.some(et => cf.facts["us-gaap"]?.[et]?.units?.["USD/shares"]?.length);
    throw new ErrorEdgar(soloTrimestral
      ? "EDGAR sólo tiene datos estructurados trimestrales (10-Q) de esta empresa: sus 10-K no traen XBRL anual. Cargala a mano."
      : `No encontré la ganancia por acción anual en los 10-K de esta empresa. ${CLASES}`);
  }
  const { porCierre, splits } = epsAjustado(epsH);
  const cierres = [...porCierre.keys()].sort().slice(-maxAnios);
  if (cierres.length < 4) throw new ErrorEdgar(`Hay sólo ${cierres.length} ejercicios con ganancia por acción en EDGAR; el motor necesita al menos 4.${cierres.length === 0 ? " " + CLASES : ""}`);
  let eps = cierres.map(k => porCierre.get(k)!);
  const cierre = cierres.at(-1)!;
  for (const s of splits) avisos.push(`EPS ajustado por un split ${s.factor >= 1 ? `${s.factor}:1` : `1:${Math.round(1 / s.factor)}`} (re-expresado en un 10-K presentado el ${s.desde}).`);

  const anual = (et: string[], unidad = "USD") => anuales(hechos(cf, et, unidad)).get(cierre) ?? null;
  const inst = (et: string[]) => instantes(hechos(cf, et)).get(cierre) ?? null;
  const M = (h: Hecho | null) => (h ? h.val / 1e6 : null);

  const ventasH = anual(ETIQ.ventas);
  const patrimonioH = inst(ETIQ.patrimonio);
  if (!ventasH) throw new ErrorEdgar(`No encontré las ventas del ejercicio cerrado el ${cierre}.`);
  if (!patrimonioH) throw new ErrorEdgar(`No encontré el patrimonio neto al ${cierre}.`);

  // Deuda: largo plazo no corriente + porción corriente + préstamos de corto plazo
  let deudaLP = M(inst(ETIQ.deudaLP));
  if (deudaLP === null) {
    const total = M(inst(ETIQ.deudaLPTotal)), corr = M(inst(ETIQ.deudaLPCorriente));
    if (total !== null) deudaLP = total - (corr ?? 0);
  }
  const corriente = M(inst(ETIQ.deudaCorriente)) ?? ((M(inst(ETIQ.deudaLPCorriente)) ?? 0) + (M(inst(["ShortTermBorrowings"])) ?? 0) + (M(inst(["CommercialPaper"])) ?? 0));
  const combinada = M(inst(ETIQ.deudaTotal));
  if (deudaLP === null && combinada !== null) deudaLP = combinada - corriente;
  if (deudaLP === null) { deudaLP = 0; avisos.push("No hay deuda de largo plazo informada: se tomó como cero."); }
  const deudaTotal = combinada ?? deudaLP + corriente;

  let ebit = M(anual(ETIQ.ebit));
  let intereses = M(anual(ETIQ.intereses));
  if (ebit === null) {
    const rai = M(anual(ETIQ.resultadoAntesImpuestos));
    if (rai !== null) { ebit = rai + (intereses ?? 0); avisos.push("No hay resultado operativo informado: se usó resultado antes de impuestos más intereses."); }
  }
  if (intereses === null && deudaTotal > 0) avisos.push("No encontré los intereses pagados: la cobertura de intereses queda sin dato.");
  let depreciaciones = M(anual(ETIQ.depreciaciones));
  if (depreciaciones === null) {
    const dep = M(anual(ETIQ.depreciacion)), amort = M(anual(ETIQ.amortizacion));
    if (dep !== null || amort !== null) depreciaciones = (dep ?? 0) + (amort ?? 0);
  }
  if (depreciaciones === null) avisos.push("No encontré depreciaciones: el EBITDA se aproxima con el EBIT.");

  const flujoOperativo = M(anual(ETIQ.flujoOperativo));
  const capex = M(anual(ETIQ.capex));
  if (flujoOperativo !== null && capex === null) avisos.push("No encontré inversiones en bienes de uso (capex): el flujo de caja libre queda sin dato.");

  // Acciones en circulación: portada del último formulario (dei), sumando clases, si es reciente y cierra con
  // EPS × acciones ≈ ganancia neta; si no, el promedio diluido del ejercicio.
  const gn = M(anual(ETIQ.gananciaNeta));
  const cierra = (acc: number) => !gn || Math.abs(eps.at(-1)! * acc - gn) / Math.abs(gn) <= 0.3;
  let acciones: number | null = null;
  const dei = cf.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (dei?.length) {
    const ultimaFecha = dei.reduce((m, h) => (h.end > m ? h.end : m), "");
    const ultimos = dei.filter(h => h.end === ultimaFecha);
    const accn = ultimos.reduce((m, h) => (h.filed > m.filed ? h : m)).accn;
    const portada = ultimos.filter(h => h.accn === accn).reduce((s, h) => s + h.val, 0) / 1e6;
    if (dias(cierre, ultimaFecha) > -60 && cierra(portada)) acciones = portada;
    else if (dias(cierre, ultimaFecha) > 0 && gn && eps.at(-1)) {
      // Split posterior al último 10-K: la portada ya tiene las acciones nuevas y el precio de hoy también,
      // pero la EPS sigue en la base vieja (Booking, 25:1 en 2026).
      const f = factorSplit(portada / (gn / eps.at(-1)!), 0.1); // más tolerancia: hubo recompras en el medio
      // Sólo splits hacia arriba: una portada con menos acciones suele ser una sola clase, no un split inverso.
      if (f && f > 1) {
        eps = eps.map(v => v / f);
        acciones = portada;
        avisos.push(`EPS ajustado por un split ${f >= 1 ? `${f}:1` : `1:${Math.round(1 / f)}`} posterior al último 10-K (la portada del ${ultimaFecha} ya informa ${Math.round(portada)} M de acciones).`);
      }
    }
  }
  if (!acciones) {
    const prom = M(anual(ETIQ.accionesPromedio, "shares"));
    if (prom && cierra(prom)) { acciones = prom; avisos.push("Acciones: se usó el promedio diluido del ejercicio (no hay dato de portada reciente)."); }
    else if (prom || dei?.length) throw new ErrorEdgar(`La ganancia por acción por las acciones informadas no da la ganancia neta${gn ? ` (${Math.round(gn)} M)` : ""}: la empresa reporta por clase de acción. ${CLASES}`);
  }
  if (!acciones) throw new ErrorEdgar("No encontré la cantidad de acciones en circulación.");

  // Dividendos: años seguidos, hacia atrás, con dividendo por acción o pagos de dividendos > 0
  const divPA = anuales(hechos(cf, ETIQ.dividendosPA, "USD/shares"));
  const divPag = anuales(hechos(cf, ETIQ.dividendosPagados));
  const todosCierres = [...anuales(hechos(cf, ETIQ.gananciaNeta)).keys(), ...porCierre.keys()];
  const aniosCon = [...new Set(todosCierres.map(anioFiscal))].sort().reverse();
  const pagoEn = (anio: number) =>
    [...divPA.entries(), ...divPag.entries()].some(([k, h]) => anioFiscal(k) === anio && h.val > 0);
  let aniosDividendos = 0;
  for (const a of aniosCon) { if (pagoEn(a)) aniosDividendos++; else break; }

  const sic = sub.sic ? Number(sub.sic) : null;
  const cls = clasificarSic(sic, ticker.toUpperCase());
  const faltantes = [
    ["activo corriente", inst(ETIQ.activoCorriente)], ["pasivo corriente", inst(ETIQ.pasivoCorriente)], ["caja", inst(ETIQ.caja)], ["flujo operativo", flujoOperativo],
  ].filter(([, v]) => v === null).map(([n]) => n);
  if (faltantes.length && !cls.financiera) avisos.push(`Sin dato en el 10-K: ${faltantes.join(", ")}.`);

  const avisosFinales = cls.financiera ? avisos.filter(a => /^(EPS|Acciones|EDGAR no trae)/.test(a)) : avisos;

  const cik = String(cf.cik).padStart(10, "0");
  const base: Empresa = {
    ticker: ticker.toUpperCase(),
    nombre: titulo(sub.name || cf.entityName),
    sector: sub.sicDescription ? `${cls.sector} · ${sub.sicDescription.toLowerCase()}` : cls.sector,
    precio: precio ?? 0,
    acciones,
    eps,
    anios: cierres.map(anioFiscal),
    ventas: ventasH.val / 1e6,
    patrimonio: patrimonioH.val / 1e6,
    activoCorriente: cls.financiera ? null : M(inst(ETIQ.activoCorriente)),
    pasivoCorriente: cls.financiera ? null : M(inst(ETIQ.pasivoCorriente)),
    caja: M(inst(ETIQ.caja)),
    deudaTotal: cls.financiera ? null : deudaTotal,
    deudaLP: cls.financiera ? null : deudaLP,
    ebit: cls.financiera ? null : ebit,
    depreciaciones: cls.financiera ? null : depreciaciones,
    intereses: cls.financiera ? null : intereses,
    flujoOperativo: cls.financiera ? null : flujoOperativo,
    capex: cls.financiera ? null : capex,
    aniosDividendos,
    aniosDividendosDisponibles: aniosCon.length,
    banco: cls.financiera,
    ciclica: cls.ciclica,
    fuente: {
      tipo: "edgar",
      cik,
      cierre,
      formulario: ventasH.form,
      presentado: ventasH.filed,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K`,
      moneda: "USD",
      avisos: avisosFinales,
    },
  };
  return base as Empresa & { precio: number };
}
