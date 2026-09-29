import { describe, expect, it } from "vitest";
import { analizar, validarEmpresa } from "../src/engine/analisis.ts";
import { EJEMPLOS } from "../src/engine/ejemplos.ts";
import { parsearLista } from "../src/engine/formato.ts";
import { promptS2, validarS2 } from "../src/engine/sistema2.ts";

const ej = (t: string) => analizar(EJEMPLOS.find(e => e.ticker === t)!);

describe("motor", () => {
  it("es determinístico: los mismos datos dan el mismo resultado", () => {
    const a = ej("ACME"), b = ej("ACME");
    expect(a.s1.p50).toBe(b.s1.p50);
    expect(a.s1.veredicto).toBe(b.s1.veredicto);
  });

  it("cada ejemplo cae en el caso para el que fue pensado", () => {
    expect(ej("PLAC").s1.veredicto).toBe("comprar");
    expect(ej("CEIB").s1.veredicto).toBe("comprar");
    expect(ej("ACME").s1.veredicto).toBe("justo");
    expect(ej("FSUR").s1.veredicto).toBe("evitar");
    expect(ej("RNOR").s1.veredicto).toBe("evitar");
  });

  it("escala al Sistema 2 los choques de señales y las cíclicas", () => {
    expect(ej("NIMB").s1.escalar.some(r => r.startsWith("Choque de señales"))).toBe(true);
    expect(ej("ACLI").s1.escalar.some(r => r.startsWith("Empresa cíclica"))).toBe(true);
    expect(ej("PLAC").s1.escalar).toHaveLength(0);
  });

  it("no confunde crecimiento sostenido con un ciclo", () => {
    const base = { ...EJEMPLOS.find(e => e.ticker === "ACME")!, ciclica: false };
    const crece = analizar({ ...base, eps: [1, 1.3, 1.7, 2.2, 2.8, 3.7, 4.8, 6.3, 8.1, 10.6] });
    expect(crece.d.ciclica).toBe(false);
    expect(crece.d.volatilidad).toBeLessThan(0.1);
    const acero = analizar({ ...base, eps: [0.5, 2.1, 0.4, 1.8, 3.0, 0.6, 0.9, 2.8, 3.1, 0.7] });
    expect(acero.d.ciclica).toBe(true);
  });

  it("si la caja es muy baja frente a la ganancia, valúa por ganancia (inversión récord)", () => {
    const e = { ...EJEMPLOS.find(x => x.ticker === "ACME")!, capex: 590 };
    const a = analizar(e);
    expect(a.d.flujoBajo).toBe(true);
    expect(a.d.baseFlujo).toBeCloseTo(0.6 * a.d.epsFin);
  });

  it("no aplica liquidez ni deuda a un banco", () => {
    const a = ej("BAUS");
    expect(a.d.criterios.find(k => k.nombre === "Liquidez corriente")?.pasa).toBeNull();
    expect(a.d.valuaciones.map(v => v.id)).toContain("pbjust");
  });

  it("marca falta de historia en vez de fallar", () => {
    const e = { ...EJEMPLOS[0], eps: [1, 1.1, 1.2, 1.3, 1.4] };
    const a = analizar(e);
    expect(a.d.criterios.find(k => k.nombre === "Ganancias positivas")?.nota).toContain("5 años");
  });

  it("valida los datos mínimos", () => {
    expect(validarEmpresa({ ...EJEMPLOS[0], eps: [1] })).toMatch(/eps/);
    expect(validarEmpresa({ ...EJEMPLOS[0], precio: 0 })).toMatch(/precio/);
    expect(validarEmpresa(EJEMPLOS[0])).toBeNull();
  });
});

describe("entrada manual", () => {
  it("entiende listas con coma decimal o punto decimal", () => {
    expect(parsearLista("1,20; 1,31; -0,4")).toEqual([1.2, 1.31, -0.4]);
    expect(parsearLista("1.2 1.31 -0.4")).toEqual([1.2, 1.31, -0.4]);
    expect(parsearLista("1.2,1.31,1.5")).toEqual([1.2, 1.31, 1.5]);
  });
});

describe("sistema 2", () => {
  it("el prompt lleva las razones del escalamiento y los datos", () => {
    const p = promptS2(ej("NIMB"));
    expect(p).toContain("Choque de señales");
    expect(p).toContain('"ticker":"NIMB"');
  });

  it("valida y recorta la respuesta", () => {
    expect(validarS2({ veredicto: "comprar", confianza: 2, resumen: "x", argumentos: ["a", "b", "c", "d", "e"], riesgos: [], que_verificar: [] }))
      .toMatchObject({ veredicto: "comprar", confianza: 1, argumentos: ["a", "b", "c", "d"] });
    expect(validarS2({ veredicto: "vender" })).toBeNull();
    expect(validarS2("hola")).toBeNull();
  });
});
