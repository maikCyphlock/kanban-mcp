import { createClient, type Client, type InValue } from "@libsql/client";
import { createHash, timingSafeEqual } from "node:crypto";

// Flujo: backlog → ready → in_progress → review → human_review → done (+ blocked)
// review_policy: agent (1 revisor cualquiera) | human (solo humano) | agent_then_human (agente y luego humano)
export type Kind = "agent" | "human";
export type Actor = { id: string; kind: Kind; name: string };
export type Status = "backlog" | "ready" | "in_progress" | "review" | "human_review" | "done" | "blocked";
export type Policy = "agent" | "human" | "agent_then_human";
export type Task = {
  id: number; title: string; description: string; status: Status; priority: number;
  project: string; role: string | null; review_policy: Policy; assignee: string | null; lease_until: number | null;
  created_by: string; created_at: number; updated_at: number;
};
export type Event = { id: number; task_id: number; actor: string; kind: string; body: string; status: Status | null; created_at: number };

export const STATUSES: Status[] = ["backlog", "ready", "in_progress", "review", "human_review", "done", "blocked"];
export const POLICIES: Policy[] = ["agent", "human", "agent_then_human"];
const LEASE_MS = 30 * 60_000; // un agente que no da señales en 30 min libera la tarea

const SCHEMA = `
create table if not exists tasks (
  id integer primary key,
  title text not null,
  description text not null default '',
  status text not null default 'ready' check (status in ('backlog','ready','in_progress','review','human_review','done','blocked')),
  priority integer not null default 2 check (priority between 0 and 3),
  role text,
  review_policy text not null default 'agent_then_human' check (review_policy in ('agent','human','agent_then_human')),
  assignee text,
  lease_until integer,
  created_by text not null,
  created_at integer not null,
  updated_at integer not null
);
create table if not exists events (
  id integer primary key,
  task_id integer not null references tasks(id),
  actor text not null,
  kind text not null,
  body text not null default '',
  created_at integer not null
);
create index if not exists events_task on events(task_id);
`;

let client: Client | undefined;
let migrated: Promise<void> | undefined;

async function db() {
  client ??= createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:kanban.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  // ponytail: migración aditiva sin versionado; usar migraciones reales si el esquema crece
  migrated ??= client.executeMultiple(SCHEMA).then(async () => {
    for (const sql of [
      "alter table events add column status text",
      "alter table tasks add column project text not null default 'general'",
    ]) await client!.execute(sql).catch(() => {});
  });
  await migrated;
  return client;
}

// KANBAN_AGENTS / KANBAN_HUMANS = "nombre:token,nombre2:token2"
// Los tokens de agente solo sirven en /api/mcp y los humanos solo en la web:
// un agente nunca puede hacerse pasar por humano para aprobar.
const sha = (s: string) => createHash("sha256").update(s).digest();
export function actorFromToken(kind: Kind, token?: string | null): Actor | undefined {
  if (!token) return;
  const t = sha(token);
  for (const pair of (process.env[kind === "agent" ? "KANBAN_AGENTS" : "KANBAN_HUMANS"] ?? "").split(",")) {
    const i = pair.indexOf(":");
    const name = pair.slice(0, i).trim();
    const secret = pair.slice(i + 1).trim();
    if (i > 0 && secret && timingSafeEqual(sha(secret), t)) return { id: `${kind}:${name}`, kind, name };
  }
}

const leaseFor = (assignee: string | null, now: number) => (assignee?.startsWith("agent:") ? now + LEASE_MS : null);

// status = estado resultante si el evento lo cambió (el chatter lo muestra como tracking)
async function log(taskId: number, actor: Actor, kind: string, body = "", status: Status | null = null) {
  await (await db()).execute({
    sql: "insert into events (task_id, actor, kind, body, status, created_at) values (?, ?, ?, ?, ?, ?)",
    args: [taskId, actor.id, kind, body, status, Date.now()],
  });
}

async function get(id: number) {
  const r = await (await db()).execute({ sql: "select * from tasks where id = ?", args: [id] });
  if (!r.rows[0]) throw new Error(`Tarea ${id} no existe`);
  return r.rows[0] as unknown as Task;
}

// UPDATE condicional: si otro actor cambió la tarea antes, falla en vez de pisarla.
async function change(id: number, set: Record<string, InValue>, where: string, whereArgs: InValue[] = []) {
  const keys = Object.keys(set);
  const r = await (await db()).execute({
    sql: `update tasks set ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? where id = ? and (${where}) returning *`,
    args: [...keys.map((k) => set[k]), Date.now(), id, ...whereArgs],
  });
  if (r.rows[0]) return r.rows[0] as unknown as Task;
  const t = await get(id);
  throw new Error(`No permitido sobre tarea ${id} (status=${t.status}, assignee=${t.assignee ?? "-"})`);
}

export async function listTasks(f: { status?: Status; role?: string; assignee?: string; q?: string; project?: string } = {}) {
  const where = [f.status ? "status = ?" : "status != 'done'"];
  const args: InValue[] = f.status ? [f.status] : [];
  if (f.role) where.push("role = ?"), args.push(f.role);
  if (f.assignee) where.push("assignee = ?"), args.push(f.assignee);
  if (f.project) where.push("project = ?"), args.push(f.project);
  // ponytail: LIKE sin índice, pasar a FTS5 si hay miles de tareas
  for (const w of f.q?.split(/\s+/).filter(Boolean) ?? []) {
    where.push("(title like ? or description like ?)"), args.push(`%${w}%`, `%${w}%`);
  }
  const r = await (await db()).execute({
    sql: `select * from tasks where ${where.join(" and ")} order by priority, id limit 200`,
    args,
  });
  return r.rows as unknown as Task[];
}

export async function getTask(id: number) {
  const task = await get(id);
  const r = await (await db()).execute({ sql: "select * from events where task_id = ? order by id", args: [id] });
  return { task, events: r.rows as unknown as Event[] };
}

export async function recentEvents(limit = 300) {
  const r = await (await db()).execute({ sql: "select * from events order by id desc limit ?", args: [limit] });
  return r.rows as unknown as Event[];
}

// Cada conexión MCP y cada vista web trabaja dentro de un proyecto (p.ej. "djesus").
export const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export async function projects() {
  const r = await (await db()).execute("select distinct project from tasks order by project");
  return r.rows.map((x) => String(x.project));
}

export async function createTask(
  actor: Actor,
  i: { project: string; title: string; description?: string; priority?: number; role?: string; status?: "backlog" | "ready"; review_policy?: Policy },
) {
  if (i.review_policy && actor.kind !== "human") throw new Error("Solo un humano puede fijar review_policy");
  if (!PROJECT_RE.test(i.project)) throw new Error(`Proyecto inválido: "${i.project}" (minúsculas, números y guiones)`);
  const now = Date.now();
  const r = await (await db()).execute({
    sql: `insert into tasks (project, title, description, priority, role, status, review_policy, created_by, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning *`,
    args: [i.project, i.title, i.description ?? "", i.priority ?? 2, i.role || null, i.status ?? "ready",
      i.review_policy ?? "agent_then_human", actor.id, now, now],
  });
  const task = r.rows[0] as unknown as Task;
  await log(task.id, actor, "created", "", task.status);
  return task;
}

// Atómico: dos agentes llamando a la vez nunca reciben la misma tarea.
// Reclamar una tarea propia renueva el lease (heartbeat).
export async function claimTask(actor: Actor, i: { id?: number; role?: string; project?: string } = {}) {
  const now = Date.now();
  const r = await (await db()).execute({
    sql: `update tasks set status = 'in_progress', assignee = :me, lease_until = :lease, updated_at = :now
          where id = (select id from tasks
            where (status = 'ready' or (status = 'in_progress' and (lease_until < :now or assignee = :me)))
              and (:id is null or id = :id) and (:role is null or role = :role) and (:project is null or project = :project)
            order by priority, id limit 1)
          returning *`,
    args: { me: actor.id, lease: leaseFor(actor.id, now), now, id: i.id ?? null, role: i.role ?? null, project: i.project ?? null },
  });
  const task = r.rows[0] as unknown as Task | undefined;
  if (!task) {
    if (i.id == null) return null;
    const t = await get(i.id);
    throw new Error(`Tarea ${i.id} no reclamable (status=${t.status}, assignee=${t.assignee ?? "-"})`);
  }
  await log(task.id, actor, "claimed", "", "in_progress");
  return task;
}

export async function releaseTask(actor: Actor, id: number, note = "") {
  const t = await change(id, { status: "ready", assignee: null, lease_until: null }, "status = 'in_progress' and assignee = ?", [actor.id]);
  await log(id, actor, "released", note, "ready");
  return t;
}

// Notas tipadas (estilo "Registrar nota" de Odoo): se guardan como events.kind = "note:<tipo>".
export const NOTE_TYPES = ["progress", "decision", "blocker", "question", "handoff"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

// Pregunta de un agente que ningún humano ha contestado todavía (cualquier evento humano posterior la cierra).
export function pendingQuestion(events: Event[]) {
  const q = events.findLast((e) => e.kind === "note:question");
  return q && !events.some((e) => e.id > q.id && e.actor.startsWith("human:")) ? q : undefined;
}

export async function comment(actor: Actor, id: number, body: string, note?: NoteType) {
  if (note && !NOTE_TYPES.includes(note)) throw new Error(`Tipo de nota inválido: ${note}`);
  const t = await get(id);
  await log(id, actor, note ? `note:${note}` : "comment", body);
  if (t.assignee === actor.id && t.status === "in_progress") {
    return change(id, { lease_until: leaseFor(actor.id, Date.now()) }, "assignee = ?", [actor.id]);
  }
  return t;
}

export async function updateTask(
  actor: Actor,
  id: number,
  p: { title?: string; description?: string; priority?: number; role?: string; status?: "backlog" | "ready" | "blocked"; review_policy?: Policy },
  note = "",
) {
  if (p.review_policy && actor.kind !== "human") throw new Error("Solo un humano puede cambiar review_policy");
  if (p.status && !["backlog", "ready", "blocked"].includes(p.status)) {
    throw new Error("Para in_progress/review/done usa claim_task, submit_for_review o review_task");
  }
  const set: Record<string, InValue> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined) set[k] = v;
  if (p.status === "ready" || p.status === "backlog") Object.assign(set, { assignee: null, lease_until: null });
  if (p.status === "blocked") set.lease_until = null;
  if (!Object.keys(set).length) return get(id);
  // Agentes: solo tareas libres o en curso propias. Humanos: cualquiera (incluso reabrir done).
  const t = actor.kind === "human"
    ? await change(id, set, "1")
    : await change(id, set, "status in ('backlog','ready','blocked') or (status = 'in_progress' and assignee = ?)", [actor.id]);
  await log(id, actor, "updated", JSON.stringify({ ...p, note: note || undefined }), p.status ?? null);
  return t;
}

export async function submitForReview(actor: Actor, id: number, summary: string) {
  const cur = await get(id);
  const next: Status = cur.review_policy === "human" ? "human_review" : "review";
  const t = await change(id, { status: next, lease_until: null }, "status = 'in_progress' and assignee = ?", [actor.id]);
  await log(id, actor, "submitted", summary, t.status);
  return t;
}

export async function reviewTask(actor: Actor, id: number, verdict: "approve" | "request_changes", body: string) {
  const cur = await get(id);
  if (cur.status !== "review" && cur.status !== "human_review") throw new Error(`Tarea ${id} no está en revisión (status=${cur.status})`);
  if (cur.assignee === actor.id) throw new Error("No puedes revisar tu propio trabajo");
  if (cur.status === "human_review" && actor.kind !== "human") throw new Error("Esta tarea espera revisión humana");
  if (verdict === "request_changes" && !body.trim()) throw new Error("Explica qué cambiar");

  const now = Date.now();
  const set: Record<string, InValue> =
    verdict === "request_changes"
      ? { status: "in_progress", lease_until: leaseFor(cur.assignee, now) }
      : { status: actor.kind === "human" || cur.review_policy === "agent" ? "done" : "human_review" };
  const t = await change(id, set, "status = ?", [cur.status]);
  await log(id, actor, verdict === "approve" ? (t.status === "done" ? "approved" : "agent_approved") : "changes_requested", body, t.status);
  return t;
}
