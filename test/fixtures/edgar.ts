import type { CompanyFacts, Hecho, Submissions } from "../../src/edgar/xbrl.ts";

/*
 * Companyfacts sintético con la misma forma que devuelve data.sec.gov.
 * Cada 10-K (presentado en febrero) repite los últimos 3 ejercicios, como en la realidad.
 */
export const ANIOS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];
export const EPS_REAL = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9]; // ya ajustado por el split 2:1 de 2021
const presentado = (fy: number) => `${fy + 1}-02-15`;

function anual(valor: (anio: number, filing: number) => number, desde = 2014, hasta = 2023): Hecho[] {
  const out: Hecho[] = [];
  for (let fy = desde; fy <= hasta; fy++)
    for (const anio of [fy - 2, fy - 1, fy]) {
      if (anio < desde) continue;
      out.push({ start: `${anio}-01-01`, end: `${anio}-12-31`, val: valor(anio, fy), accn: `acc-${fy}`, fy, fp: "FY", form: "10-K", filed: presentado(fy) });
    }
  return out;
}
const instante = (val: number, anio = 2023): Hecho[] => [{ end: `${anio}-12-31`, val, accn: `acc-${anio}`, fy: anio, fp: "FY", form: "10-K", filed: presentado(anio) }];
const usd = (h: Hecho[]) => ({ units: { USD: h } });

export function facts(): CompanyFacts {
  return {
    cik: 12345,
    entityName: "TEST BEBIDAS CO",
    facts: {
      dei: {
        EntityCommonStockSharesOutstanding: { units: { shares: [
          { end: "2024-02-01", val: 300e6, accn: "acc-2023", form: "10-K", filed: "2024-02-15" },
          { end: "2024-02-01", val: 100e6, accn: "acc-2023", form: "10-K", filed: "2024-02-15" },
          { end: "2023-02-01", val: 390e6, accn: "acc-2022", form: "10-K", filed: "2023-02-15" },
        ] } },
      },
      "us-gaap": {
        // Antes del split (10-K presentados hasta 2021) el EPS era el doble.
        EarningsPerShareDiluted: { units: { "USD/shares": anual((anio, fy) => EPS_REAL[anio - 2014] * (fy <= 2020 ? 2 : 1)) } },
        SalesRevenueNet: usd(anual(anio => (1000 + 100 * (anio - 2014)) * 1e6, 2014, 2017)),
        Revenues: usd(anual(anio => (1000 + 100 * (anio - 2014)) * 1e6, 2018, 2023)),
        NetIncomeLoss: usd(anual(anio => EPS_REAL[anio - 2014] * 400e6)),
        OperatingIncomeLoss: usd(anual(() => 1100e6)),
        DepreciationDepletionAndAmortization: usd(anual(() => 150e6)),
        InterestExpense: usd(anual(() => 50e6)),
        NetCashProvidedByUsedInOperatingActivities: usd(anual(() => 900e6)),
        PaymentsToAcquirePropertyPlantAndEquipment: usd(anual(() => 200e6)),
        CommonStockDividendsPerShareDeclared: { units: { "USD/shares": anual(() => 0.5, 2016, 2023) } },
        StockholdersEquity: usd(instante(5000e6)),
        AssetsCurrent: usd(instante(3000e6)),
        LiabilitiesCurrent: usd(instante(1200e6)),
        CashAndCashEquivalentsAtCarryingValue: usd(instante(600e6)),
        LongTermDebtNoncurrent: usd(instante(1500e6)),
        DebtCurrent: usd(instante(300e6)),
      },
    },
  };
}
export const SUB: Submissions = { cik: "0000012345", name: "TEST BEBIDAS CO", sic: "2080", sicDescription: "Beverages" };

