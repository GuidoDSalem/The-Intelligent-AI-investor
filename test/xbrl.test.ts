import { describe, expect, it } from "vitest";
import { empresaDesdeEdgar, ErrorEdgar } from "../src/edgar/xbrl.ts";
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
    expect(e.sector.startsWith("Industria")).toBe(true);
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
