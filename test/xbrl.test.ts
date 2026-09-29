import { describe, expect, it } from "vitest";
import { anioFiscal, empresaDesdeEdgar, ErrorEdgar, ingresosRecientes, sectorPorSic } from "../src/edgar/xbrl.ts";
import { ANIOS, EPS_REAL, facts, SUB } from "./fixtures/edgar.ts";
import { analizar } from "../src/engine/analisis.ts";

describe("empresaDesdeEdgar", () => {
  const e = empresaDesdeEdgar(facts(), SUB, "tbc", 30);

  it("toma 10 ejercicios de EPS y los ajusta por el split", () => {
    expect(e.anios).toEqual(ANIOS);
    e.eps.forEach((v, i) => expect(v).toBeCloseTo(EPS_REAL[i], 6));
    expect(e.fuente?.avisos?.some(a => a.includes("split 2:1"))).toBe(true);
  });

  it("usa el último ejercicio para balance, resultados y flujo (en millones)", () => {
    expect(e.ventas).toBeCloseTo(1900);
    expect(e.patrimonio).toBe(5000);
    expect(e.activoCorriente).toBe(3000);
    expect(e.deudaLP).toBe(1500);
    expect(e.deudaTotal).toBe(1800);
    expect(e.ebit).toBe(1100);
    expect(e.flujoOperativo).toBe(900);
    expect(e.capex).toBe(200);
    expect(e.fuente?.cierre).toBe("2023-12-31");
  });

  it("suma las clases de acciones de la última portada", () => {
    expect(e.acciones).toBe(400);
  });

  it("cuenta dividendos seguidos hacia atrás hasta el primer año sin pago", () => {
    expect(e.aniosDividendos).toBe(8);
    expect(e.aniosDividendosDisponibles).toBe(10);
  });

  it("clasifica por SIC y arma el nombre", () => {
    expect(e.ticker).toBe("TBC");
    expect(e.nombre).toBe("Test Bebidas Co");
    expect(e.sector.startsWith("Consumo básico")).toBe(true);
    expect(e.banco).toBe(false);
  });

  it("el resultado se puede analizar", () => {
    const a = analizar(e);
    expect(a.d.criterios.find(k => k.nombre === "Crecimiento de EPS")?.pasa).toBe(true);
    expect(a.s1.p50).toBeGreaterThan(0);
  });

  it("deja el precio en 0 si no hay cotización", () => {
    expect(empresaDesdeEdgar(facts(), SUB, "TBC", null).precio).toBe(0);
  });

  it("a una financiera no le pide liquidez ni deuda", () => {
    const b = empresaDesdeEdgar(facts(), { ...SUB, sic: "6022", sicDescription: "State commercial banks" }, "BNK", 20);
    expect(b.banco).toBe(true);
    expect(b.activoCorriente).toBeNull();
    expect(b.deudaTotal).toBeNull();
    const a = analizar(b);
    expect(a.d.valuaciones.some(v => v.id === "pbjust")).toBe(true);
  });

  it("rechaza con un mensaje claro a quien reporta en IFRS", () => {
    const cf = facts();
    cf.facts = { "ifrs-full": {} };
    expect(() => empresaDesdeEdgar(cf, SUB, "X", 1)).toThrow(ErrorEdgar);
  });
});

describe("casos vistos en datos reales", () => {
  it("rotula bien los ejercicios de 52/53 semanas que cierran a principios de enero", () => {
    expect(anioFiscal("2017-01-01")).toBe(2016);
    expect(anioFiscal("2026-01-25")).toBe(2026);
    expect(anioFiscal("2025-12-28")).toBe(2025);
  });

  it("si la portada es vieja, usa el promedio diluido (Mastercard)", () => {
    const cf = facts();
    cf.facts.dei.EntityCommonStockSharesOutstanding.units.shares = [{ end: "2010-10-27", val: 122e6, accn: "viejo", form: "10-Q", filed: "2010-10-28" }];
    cf.facts["us-gaap"].WeightedAverageNumberOfDilutedSharesOutstanding = { units: { shares: [
      { start: "2023-01-01", end: "2023-12-31", val: 401e6, accn: "acc-2023", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-15" },
    ] } };
    const e = empresaDesdeEdgar(cf, SUB, "TBC", 30);
    expect(e.acciones).toBe(401);
    expect(e.fuente?.avisos?.some(a => a.startsWith("Acciones"))).toBe(true);
  });

  it("rechaza cuando EPS × acciones no da la ganancia neta (varias clases)", () => {
    const cf = facts();
    cf.facts.dei.EntityCommonStockSharesOutstanding.units.shares = [{ end: "2024-02-01", val: 50e6, accn: "acc-2023", form: "10-K", filed: "2024-02-15" }];
    expect(() => empresaDesdeEdgar(cf, SUB, "TBC", 30)).toThrow(/clase de acción/);
  });

  it("suma amortización de intangibles cuando sólo hay depreciación (Broadcom)", () => {
    const cf = facts();
    const ga = cf.facts["us-gaap"];
    ga.Depreciation = ga.DepreciationDepletionAndAmortization;
    delete ga.DepreciationDepletionAndAmortization;
    ga.AmortizationOfIntangibleAssets = { units: { USD: ga.Depreciation.units.USD.map(h => ({ ...h, val: 800e6 })) } };
    expect(empresaDesdeEdgar(cf, SUB, "TBC", 30).depreciaciones).toBe(950);
  });

  it("sin capex el flujo libre queda sin dato, no en cero (Eli Lilly)", () => {
    const cf = facts();
    delete cf.facts["us-gaap"].PaymentsToAcquirePropertyPlantAndEquipment;
    const e = empresaDesdeEdgar(cf, SUB, "TBC", 30);
    expect(e.capex).toBeNull();
    expect(analizar(e).d.fcf).toBeNull();
  });

  it("toma la deuda combinada cuando no hay deuda de largo plazo separada (Oracle)", () => {
    const cf = facts();
    const ga = cf.facts["us-gaap"];
    delete ga.LongTermDebtNoncurrent;
    ga.DebtLongtermAndShorttermCombinedAmount = { units: { USD: ga.DebtCurrent.units.USD.map(h => ({ ...h, val: 2000e6 })) } };
    const e = empresaDesdeEdgar(cf, SUB, "TBC", 30);
    expect(e.deudaTotal).toBe(2000);
    expect(e.deudaLP).toBe(1700);
  });

  it("explica cuando EDGAR sólo tiene datos trimestrales (Exxon)", () => {
    const cf = facts();
    const eps = cf.facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"];
    cf.facts["us-gaap"].EarningsPerShareDiluted.units["USD/shares"] = eps.map(h => ({ ...h, form: "10-Q" }));
    expect(() => empresaDesdeEdgar(cf, SUB, "TBC", 30)).toThrow(/trimestrales/);
  });

  it("detecta un split posterior al último 10-K con la portada de un 10-Q (Booking)", () => {
    const cf = facts();
    // 4:1 después del 10-K, con algo de recompra: 1.520 M en vez de 1.600 M
    cf.facts.dei.EntityCommonStockSharesOutstanding.units.shares.push({ end: "2024-07-25", val: 1520e6, accn: "q2-2024", form: "10-Q", filed: "2024-07-30" });
    const e = empresaDesdeEdgar(cf, SUB, "TBC", 30);
    expect(e.acciones).toBe(1520);
    expect(e.eps.at(-1)).toBeCloseTo(1.9 / 4);
    expect(e.fuente?.avisos?.some(a => a.includes("posterior al último 10-K"))).toBe(true);
  });

  it("clasifica en sectores tipo GICS", () => {
    expect(sectorPorSic(3674)).toBe("Tecnología");
    expect(sectorPorSic(2834)).toBe("Salud");
    expect(sectorPorSic(5961)).toBe("Consumo discrecional");
    expect(sectorPorSic(5331)).toBe("Consumo básico");
    expect(sectorPorSic(6021)).toBe("Finanzas");
    expect(sectorPorSic(6798)).toBe("Inmobiliario");
    expect(sectorPorSic(7389, "V")).toBe("Finanzas");
  });

  it("distingue emisoras extranjeras y entidades sin 10-K", () => {
    const f = (form: string[]) => ({ ...SUB, filings: { recent: { form } } });
    expect(() => empresaDesdeEdgar(facts(), f(["20-F", "6-K"]), "TM", 1)).toThrow(/extranjera/);
    expect(() => empresaDesdeEdgar(facts(), f(["10-Q", "8-K"]), "XOM", 1)).toThrow(/todavía no presentó un 10-K/);
    expect(empresaDesdeEdgar(facts(), f(["10-K", "10-Q"]), "TBC", 30).ticker).toBe("TBC");
  });

  it("estima los ingresos anuales recientes, también desde un 10-Q", () => {
    const cf = facts();
    expect(ingresosRecientes(cf)).toBeCloseTo(1900);
    cf.facts["us-gaap"].Revenues.units.USD.push({ start: "2024-01-01", end: "2024-03-31", val: 600e6, accn: "q1", form: "10-Q", filed: "2024-04-30" });
    expect(ingresosRecientes(cf)).toBeCloseTo(2400);
  });
});
