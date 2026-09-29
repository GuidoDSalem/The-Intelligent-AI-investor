import { describe, expect, it } from "vitest";
import { squarify } from "../src/engine/mapa.ts";

describe("squarify", () => {
  const r = { x: 0, y: 0, w: 600, h: 400 };
  const valores = [500, 300, 200, 120, 80, 50, 30, 10, 5, 5];
  const celdas = squarify(valores, v => v, r);

  it("reparte todo el área en proporción a cada valor", () => {
    const total = valores.reduce((a, b) => a + b, 0);
    expect(celdas).toHaveLength(valores.length);
    for (const c of celdas) expect(c.w * c.h).toBeCloseTo((c.item / total) * r.w * r.h, 6);
    expect(celdas.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(r.w * r.h, 6);
  });

  it("no se sale del rectángulo ni superpone celdas", () => {
    for (const c of celdas) {
      expect(c.x).toBeGreaterThanOrEqual(-1e-9); expect(c.y).toBeGreaterThanOrEqual(-1e-9);
      expect(c.x + c.w).toBeLessThanOrEqual(r.w + 1e-6); expect(c.y + c.h).toBeLessThanOrEqual(r.h + 1e-6);
    }
    for (let i = 0; i < celdas.length; i++)
      for (let j = i + 1; j < celdas.length; j++) {
        const a = celdas[i], b = celdas[j];
        const sx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), sy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(sx > 1e-6 && sy > 1e-6).toBe(false);
      }
  });

  it("ignora valores nulos o negativos", () => {
    expect(squarify([0, -3, 5], v => v, r)).toHaveLength(1);
  });
});
