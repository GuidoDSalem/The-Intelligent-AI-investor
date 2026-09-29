import Anthropic from "@anthropic-ai/sdk";
import { ESQUEMA_S2, type RespuestaS2, validarS2 } from "../engine/sistema2.ts";

/**
 * Sistema 2 del lado del servidor: una sola llamada a Claude con salida estructurada.
 * Sólo se usa cuando hay credenciales (ANTHROPIC_API_KEY o un perfil de `ant auth login`).
 */
export const MODELO_S2 = process.env.MODELO_S2 || "claude-opus-5-5";

let cliente: Anthropic | null = null;
export function claudeDisponible(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}

export class ErrorS2 extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export async function consultarS2(prompt: string): Promise<RespuestaS2> {
  cliente ??= new Anthropic();
  let msg;
  try {
    msg = await cliente.beta.messages.create({
      model: MODELO_S2,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // Si los clasificadores de seguridad rechazan el pedido, la API lo reintenta en el modelo recomendado.
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: ESQUEMA_S2 } },
      messages: [{ role: "user", content: prompt }],
    } as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ErrorS2("Las credenciales de Anthropic no son válidas.", 401);
    if (e instanceof Anthropic.RateLimitError) throw new ErrorS2("Demasiadas consultas seguidas a Claude. Probá de nuevo en un rato.", 429);
    if (e instanceof Anthropic.APIError) throw new ErrorS2(`La API de Claude respondió ${e.status ?? "con error"}: ${e.message}`);
    throw new ErrorS2(`No pude conectarme con Claude: ${(e as Error).message}`);
  }
  if (msg.stop_reason === "refusal") throw new ErrorS2("Claude no quiso responder este caso.", 422);
  const texto = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try { json = JSON.parse(texto); } catch { throw new ErrorS2("La respuesta de Claude no vino en JSON."); }
  const r = validarS2(json);
  if (!r) throw new ErrorS2("La respuesta de Claude no tiene el formato esperado.");
  return r;
}
