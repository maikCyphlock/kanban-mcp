// Self-check del flujo: node scripts/check.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TURSO_DATABASE_URL = "file:" + join(mkdtempSync(join(tmpdir(), "kanban-")), "t.db");
const k = await import("../lib/kanban.ts");

const a1 = { id: "agent:a1", kind: "agent", name: "a1" } as const;
const a2 = { id: "agent:a2", kind: "agent", name: "a2" } as const;
const h = { id: "human:h", kind: "human", name: "h" } as const;

const t = await k.createTask(a1, { project: "p", title: "x", role: "dev" });
assert.equal(t.review_policy, "agent_then_human");
await assert.rejects(k.createTask(a1, { project: "p", title: "y", review_policy: "agent" }), /humano/);

// claim atómico: dos agentes, una tarea
const [c1, c2] = await Promise.all([k.claimTask(a1, { role: "dev" }), k.claimTask(a2, { role: "dev" })]);
assert.equal([c1, c2].filter(Boolean).length, 1);
const owner = c1 ? a1 : a2, other = c1 ? a2 : a1;

await assert.rejects(k.submitForReview(other, t.id, "no es mía"));
await k.submitForReview(owner, t.id, "hecho");
await assert.rejects(k.reviewTask(owner, t.id, "approve", ""), /propio/);
await assert.rejects(k.reviewTask(other, t.id, "request_changes", ""), /cambiar/);

// agente aprueba → pasa a revisión humana, no a done
assert.equal((await k.reviewTask(other, t.id, "approve", "ok")).status, "human_review");
await assert.rejects(k.reviewTask(other, t.id, "approve", "ok"), /humana/);
await assert.rejects(k.updateTask(other, t.id, { status: "ready" }));

// humano pide cambios → vuelve al mismo agente con lease nuevo
const back = await k.reviewTask(h, t.id, "request_changes", "falta test");
assert.equal(back.status, "in_progress");
assert.equal(back.assignee, owner.id);
assert.ok(back.lease_until! > Date.now());

await k.submitForReview(owner, t.id, "con test");
assert.equal((await k.reviewTask(h, t.id, "approve", "lgtm")).status, "done");

// lease vencido: otro agente puede tomarla
const t2 = await k.createTask(h, { project: "p", title: "z", review_policy: "agent" });
await k.claimTask(a1, { id: t2.id });
await assert.rejects(k.claimTask(a2, { id: t2.id }), /no reclamable/);
await k.comment(a1, t2.id, "trabajando");
const { createClient } = await import("@libsql/client");
await createClient({ url: process.env.TURSO_DATABASE_URL! }).execute({ sql: "update tasks set lease_until = 0 where id = ?", args: [t2.id] });
assert.equal((await k.claimTask(a2, { id: t2.id }))!.assignee, a2.id);
await k.submitForReview(a2, t2.id, "ok");
assert.equal((await k.reviewTask(a1, t2.id, "approve", "")).status, "done"); // policy agent

// búsqueda: todas las palabras deben aparecer
await k.createTask(h, { project: "p", title: "Login con Google", description: "OAuth" });
assert.equal((await k.listTasks({ q: "login oauth" })).length, 1);
assert.equal((await k.listTasks({ q: "login stripe" })).length, 0);

// proyectos aislados
await k.createTask(a1, { project: "otro", title: "solo de otro", role: "x" });
assert.equal(await k.claimTask(a2, { project: "p", role: "x" }), null);
assert.equal((await k.listTasks({ project: "otro" })).length, 1);
await assert.rejects(k.createTask(a1, { project: "Mal Nombre", title: "x" }), /inválido/);

// notas y preguntas pendientes
const tq = await k.createTask(a1, { project: "p", title: "con pregunta" });
await k.comment(a1, tq.id, "¿Usamos Postgres?", "question");
assert.ok(k.pendingQuestion((await k.getTask(tq.id)).events));
await k.comment(a2, tq.id, "yo tampoco sé", "progress");
assert.ok(k.pendingQuestion((await k.getTask(tq.id)).events)); // un agente no la cierra
await k.comment(h, tq.id, "Sí, Postgres");
assert.equal(k.pendingQuestion((await k.getTask(tq.id)).events), undefined);
await assert.rejects(k.comment(a1, tq.id, "x", "otro" as never), /inválido/);

const { events } = await k.getTask(t.id);
console.log(events.map((e) => `${e.actor} ${e.kind}`).join("\n"));
console.log("OK");
