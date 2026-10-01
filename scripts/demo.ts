// Demo en vivo: dos agentes trabajan por MCP mientras miras el tablero.
// node scripts/demo.ts [--reset] [url]   (lee los tokens de .env.local)
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const agents = Object.fromEntries(env.KANBAN_AGENTS.split(",").map((p: string) => p.split(/:(.*)/s).slice(0, 2)));
const [claude, codex] = Object.keys(agents);
const url = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3123/api/mcp?project=demo";
const STEP = Number(process.env.STEP_MS ?? 2500);

if (process.argv.includes("--reset")) {
  const { createClient } = await import("@libsql/client");
  await createClient({ url: env.TURSO_DATABASE_URL ?? "file:kanban.db" }).executeMultiple("delete from events; delete from tasks;");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(agent: string, name: string, args: object, say: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${agents[agent]}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const msg = JSON.parse(text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) ?? text);
  const out = msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error);
  const err = msg.result?.isError;
  console.log(`${err ? "✗" : "✓"} [${agent}] ${say}${err ? `  → rechazado: ${out}` : ""}`);
  await sleep(STEP);
  return err ? null : JSON.parse(out);
}

const t = (x: { id: number } | null) => x!.id;

console.log(`Agentes: ${claude}, ${codex}\n`);
await call(claude, "create_task", { title: "Migrar base de datos a Turso", role: "backend", priority: 0, description: "Mover `kanban.db` a **Turso** y configurar el entorno en Vercel.\n\n## Criterios de aceptación\n- [ ] `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` en Vercel\n- [ ] Datos migrados sin pérdida\n- [ ] `npm run check` pasa contra Turso" }, "crea tarea P0 backend");
await call(claude, "create_task", { title: "Endpoint /health", role: "backend", priority: 1, description: "Endpoint de salud para el monitor.\n\n```http\nGET /health → 200 { ok: true, version }\n```" }, "crea tarea P1 backend");
await call(claude, "create_task", { title: "Página de precios", role: "frontend", priority: 2 }, "crea tarea P2 frontend");
await call(claude, "create_task", { title: "Documentar la API", role: "docs", priority: 3 }, "crea tarea P3 docs");

const turso = await call(codex, "claim_task", { role: "backend" }, "toma la siguiente tarea backend (la P0)");
const health = await call(claude, "claim_task", { role: "backend" }, "toma la siguiente tarea backend (la P1)");
await call(codex, "claim_task", { id: t(health) }, "intenta robar la tarea de claude");

await call(claude, "add_note", { id: t(health), type: "progress", body: "Handler listo en `app/health/route.ts`" }, "nota de avance");
await call(claude, "add_note", { id: t(health), type: "decision", body: "Sin auth en `/health`: lo consulta el monitor externo. Descartado exponer versión de dependencias." }, "nota de decisión");
await call(codex, "add_note", { id: t(turso), type: "progress", body: "Base creada en Turso, falta migrar datos" }, "nota de avance");
await call(claude, "submit_for_review", { id: t(health), summary: "**Hecho:** `GET /health` → `{ ok, version }`\n\nProbar:\n```bash\ncurl localhost:3123/health\n```" }, "envía /health a revisión");
await call(claude, "review_task", { id: t(health), verdict: "approve", comment: "lgtm" }, "intenta aprobar su propio trabajo");
await call(codex, "review_task", { id: t(health), verdict: "request_changes", comment: "Falta un test que cubra el 200" }, "revisa /health y pide cambios");
await call(claude, "comment", { id: t(health), body: "Añadido `health.test.ts`:\n\n```ts\nexpect(res.status).toBe(200)\n```" }, "corrige lo pedido");
await call(claude, "submit_for_review", { id: t(health), summary: "Con test en health.test.ts" }, "reenvía a revisión");
await call(codex, "review_task", { id: t(health), verdict: "approve", comment: "Test pasa" }, "aprueba → pasa a revisión humana");

await call(codex, "submit_for_review", { id: t(turso), summary: "- Datos migrados (4 tareas, 31 eventos)\n- `TURSO_*` configuradas en Vercel\n- `npm run check` pasa contra Turso" }, "envía la migración a revisión");
await call(claude, "review_task", { id: t(turso), verdict: "approve", comment: "Verificado con turso db shell" }, "aprueba → pasa a revisión humana");
await call(claude, "review_task", { id: t(turso), verdict: "approve", comment: "ya está" }, "intenta aprobar también la revisión humana");

const precios = await call(codex, "claim_task", { role: "frontend" }, "toma la página de precios");
await call(codex, "add_note", { id: t(precios), type: "question", body: "¿Los planes se cobran **mensual**, **anual** o ambos? Necesito saberlo para el toggle de precios." }, "pregunta al humano");
await call(codex, "add_note", { id: t(precios), type: "blocker", body: "Falta el diseño de las tarjetas de planes." }, "nota de bloqueo");
await call(codex, "update_task", { id: t(precios), status: "blocked", note: "Falta el diseño de los planes" }, "la marca bloqueada: falta diseño");

console.log("\nListo: 2 tareas esperan tu revisión humana en la web.");
