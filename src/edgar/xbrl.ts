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
function factorSplit(r: number): number | null {
  const inv = r < 1;
  const x = inv ? 1 / r : r;
  if (x < 1.4) return null;
  const s = SPLITS.find(k => Math.abs(x - k) / k < 0.03);
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
export function clasificarSic(sic: number | null) {
  if (sic === null || !Number.isFinite(sic)) return { sector: "Sin clasificar", financiera: false, ciclica: false };
  const financiera = sic >= 6000 && sic < 6500;
  const ciclica =
    (sic >= 1000 && sic < 1500) || (sic >= 2800 && sic < 2830) || (sic >= 2900 && sic < 3000) ||
    (sic >= 3310 && sic < 3400) || (sic >= 3710 && sic < 3720) || (sic >= 4400 && sic < 4500) || (sic >= 1520 && sic < 1540);
  const d = Math.floor(sic / 100);
  const sector =
    d < 10 ? "Agro y pesca" : d < 15 ? "Minería y energía" : d < 18 ? "Construcción" : d < 40 ? "Industria" :
    d < 50 ? "Transporte y servicios públicos" : d < 52 ? "Comercio mayorista" : d < 60 ? "Comercio minorista" :
    d < 68 ? "Finanzas y seguros" : d < 90 ? "Servicios" : "Otros";
  return { sector, financiera, ciclica };
}

/** "COCA COLA CO" → "Coca Cola Co" */
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s\-/&.(])([a-z])/g, (_m, sep: string, l: string) => sep + l.toUpperCase());

const ETIQ = {
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  ventas: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating"],
  gananciaNeta: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
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

export function empresaDesdeEdgar(cf: CompanyFacts, sub: Submissions, ticker: string, precio: number | null, maxAnios = 10): Empresa & { precio: number } {
  const avisos: string[] = [];
  if (!cf.facts["us-gaap"]) {
    throw new ErrorEdgar(cf.facts["ifrs-full"]
      ? "Esta empresa reporta en IFRS (formulario 20-F/40-F). Por ahora el motor sólo lee estados en us-gaap: cargala a mano."
      : "EDGAR no tiene datos contables estructurados (XBRL) para esta empresa.");
  }

  // EPS por ejercicio, ajustado por splits
  const epsH = hechos(cf, ETIQ.eps, "USD/shares");
  const CLASES = "Puede que reporte la ganancia por clase de acción (como Visa o Berkshire Hathaway): cargala a mano.";
  if (!epsH.length) {
    const soloTrimestral = ETIQ.eps.some(et => cf.facts["us-gaap"]?.[et]?.units?.["USD/shares"]?.length);
    throw new ErrorEdgar(soloTrimestral
      ? "EDGAR sólo tiene datos estructurados trimestrales (10-Q) de esta empresa: sus 10-K no traen XBRL anual. Cargala a mano."
      : `No encontré la ganancia por acción anual en los 10-K de esta empresa. ${CLASES}`);
  }
  const { porCierre, splits } = epsAjustado(epsH);
  const cierres = [...porCierre.keys()].sort().slice(-maxAnios);
  if (cierres.length < 4) throw new ErrorEdgar(`Hay sólo ${cierres.length} ejercicios con ganancia por acción en EDGAR; el motor necesita al menos 4.${cierres.length === 0 ? " " + CLASES : ""}`);
  const eps = cierres.map(k => porCierre.get(k)!);
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
  const cls = clasificarSic(sic);
  const faltantes = [
    ["activo corriente", inst(ETIQ.activoCorriente)], ["pasivo corriente", inst(ETIQ.pasivoCorriente)], ["caja", inst(ETIQ.caja)], ["flujo operativo", flujoOperativo],
  ].filter(([, v]) => v === null).map(([n]) => n);
  if (faltantes.length && !cls.financiera) avisos.push(`Sin dato en el 10-K: ${faltantes.join(", ")}.`);

  const avisosFinales = cls.financiera ? avisos.filter(a => a.startsWith("EPS") || a.startsWith("Acciones")) : avisos;

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
