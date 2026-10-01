import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as k from "@/lib/kanban";

const INSTRUCTIONS = `OBLIGATORIO. Tu PRIMERA acción ante cualquier pedido de trabajo en esta carpeta (código, investigación, configuración, docs) es usar este kanban, antes de leer o editar archivos.
Al empezar la sesión: list_tasks mine=true para retomar lo tuyo. Solo quedan exentas las preguntas puramente conversacionales.
Kanban compartido entre agentes y humanos, dividido por proyectos.
Esta conexión está atada a UN proyecto (el ?project= de la URL): solo ves, tomas y creas tareas de ese proyecto.
REGLA OBLIGATORIA: antes de empezar cualquier trabajo que te pidan, busca si ya existe una tarea para eso:
list_tasks con q=<palabras clave del pedido> (y status=done si podría estar hecha). Si existe, tómala con claim_task y lee su historial con get_task.
Si no existe, créala con create_task (título claro y criterios de aceptación en Markdown) y tómala con claim_task. No trabajes fuera del kanban.
Flujo: claim_task → trabajar dejando notas con add_note → submit_for_review con un resumen verificable.
NOTAS (obligatorio, son la memoria compartida entre agentes y humanos): usa add_note con el tipo correcto:
- progress: avance concreto (qué hiciste, dónde). Al menos una por cada paso relevante.
- decision: cuando eliges un enfoque o descartas otro, con el porqué. El siguiente agente no debe repetir la discusión.
- blocker: qué te impide seguir y qué necesitas.
- question: duda que necesita a un humano. Aparece destacada en la web hasta que un humano responda; mientras, sigue con lo que puedas.
- handoff: antes de release_task o al dejar la tarea a medias: estado actual, qué falta y cómo retomarlo.
Usa comment solo para hablarle a otro agente o humano. Al tomar una tarea, lee sus notas con get_task antes de empezar.
- claim_task sin id toma la tarea 'ready' de mayor prioridad (0 = urgente). Filtra por role si eres un agente especializado.
- Tienes un lease de 30 min: comment o claim_task sobre tu tarea lo renuevan. Si caduca, otro agente puede tomarla.
- Si no puedes seguir: update_task status=blocked con nota, o release_task.
- Revisión: no puedes revisar tu propio trabajo. Tareas en human_review solo las aprueba un humano desde la web.
- Si te piden cambios, la tarea vuelve a ti en in_progress: lee los eventos con get_task antes de seguir.`;

type Ctx = { http?: { authInfo?: AuthInfo } };

// taskId: la tarea debe ser del proyecto de esta conexión (un agente de djesus no toca tareas de otro proyecto)
async function run(ctx: Ctx, fn: (me: k.Actor, project: string) => Promise<unknown>, taskId?: number) {
  const me = ctx.http?.authInfo?.extra?.actor as k.Actor;
  const project = ctx.http?.authInfo?.extra?.project as string;
  try {
    if (taskId != null && (await k.getTask(taskId)).task.project !== project) throw new Error(`Tarea ${taskId} no existe en el proyecto ${project}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(await fn(me, project), null, 2) ?? "null" }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text" as const, text: (e as Error).message }] };
  }
}

const id = z.number().int().describe("ID de la tarea");
const priority = z.number().int().min(0).max(3).describe("0 urgente … 3 baja");

const handler = createMcpHandler(
  (server) => {
    server.registerTool("list_tasks", {
      description: "Lista tareas (excluye done salvo que pidas status=done). q busca palabras en título y descripción. mine=true para las tuyas. Úsalo antes de empezar cualquier trabajo para ver si ya hay una tarea.",
      inputSchema: z.object({
        q: z.string().optional().describe("Palabras clave; todas deben aparecer"),
        status: z.enum(k.STATUSES).optional(), role: z.string().optional(), mine: z.boolean().optional(),
      }),
    }, (a, ctx) => run(ctx, (me, project) => k.listTasks({ project, q: a.q, status: a.status, role: a.role, assignee: a.mine ? me.id : undefined })));

    server.registerTool("get_task", {
      description: "Tarea + historial (mensajes, notas tipadas, revisiones) + pending_question si un humano aún no respondió. Léelo antes de trabajar.",
      inputSchema: z.object({ id }),
    }, (a, ctx) => run(ctx, async () => { const d = await k.getTask(a.id); return { ...d, pending_question: k.pendingQuestion(d.events) ?? null }; }, a.id));

    server.registerTool("create_task", {
      description: "Crea una tarea. Las creadas por agentes usan review_policy agent_then_human.",
      inputSchema: z.object({
        title: z.string().min(1), description: z.string().optional(), priority: priority.optional(),
        role: z.string().optional().describe("Tipo de agente que debe tomarla, p.ej. 'frontend'"),
        status: z.enum(["backlog", "ready"]).optional(),
      }),
    }, (a, ctx) => run(ctx, (me, project) => k.createTask(me, { ...a, project })));

    server.registerTool("claim_task", {
      description: "Toma una tarea (atómico). Sin id: la siguiente ready por prioridad. Sobre tu propia tarea renueva el lease.",
      inputSchema: z.object({ id: id.optional(), role: z.string().optional() }),
    }, (a, ctx) => run(ctx, async (me, project) => (await k.claimTask(me, { ...a, project })) ?? "No hay tareas disponibles", a.id));

    server.registerTool("release_task", {
      description: "Devuelve tu tarea a ready, con nota para quien la tome.",
      inputSchema: z.object({ id, note: z.string().optional() }),
    }, (a, ctx) => run(ctx, (me) => k.releaseTask(me, a.id, a.note), a.id));

    server.registerTool("comment", {
      description: "Mensaje en el chatter dirigido a otro agente o humano. Para avances, decisiones, bloqueos, preguntas o relevos usa add_note. Renueva tu lease.",
      inputSchema: z.object({ id, body: z.string().min(1) }),
    }, (a, ctx) => run(ctx, (me) => k.comment(me, a.id, a.body), a.id));

    server.registerTool("add_note", {
      description: "Registra una nota tipada en la tarea (memoria compartida): progress | decision | blocker | question (pide respuesta a un humano) | handoff. Markdown. Renueva tu lease.",
      inputSchema: z.object({ id, type: z.enum(k.NOTE_TYPES), body: z.string().min(1) }),
    }, (a, ctx) => run(ctx, (me) => k.comment(me, a.id, a.body, a.type), a.id));

    server.registerTool("update_task", {
      description: "Edita campos o mueve a backlog/ready/blocked. Solo tareas libres o en curso tuyas.",
      inputSchema: z.object({
        id, title: z.string().min(1).optional(), description: z.string().optional(), priority: priority.optional(),
        role: z.string().optional(), status: z.enum(["backlog", "ready", "blocked"]).optional(), note: z.string().optional(),
      }),
    }, (a, ctx) => run(ctx, (me) => { const { id, note, ...p } = a; return k.updateTask(me, id, p, note); }, a.id));

    server.registerTool("submit_for_review", {
      description: "Envía tu tarea a revisión. El resumen debe permitir verificar el trabajo (qué cambió, dónde, cómo probarlo).",
      inputSchema: z.object({ id, summary: z.string().min(1) }),
    }, (a, ctx) => run(ctx, (me) => k.submitForReview(me, a.id, a.summary), a.id));

    server.registerTool("review_task", {
      description: "Revisa una tarea en 'review' que no sea tuya. approve la avanza (a done o a human_review); request_changes la devuelve a su autor.",
      inputSchema: z.object({ id, verdict: z.enum(["approve", "request_changes"]), comment: z.string() }),
    }, (a, ctx) => run(ctx, (me) => k.reviewTask(me, a.id, a.verdict, a.comment), a.id));
  },
  { serverInfo: { name: "kanban", version: "0.1.0" }, instructions: INSTRUCTIONS },
);

const authed = withMcpAuth(
  handler,
  (req, token) => {
    const actor = k.actorFromToken("agent", token);
    const project = new URL(req.url).searchParams.get("project");
    return actor && { token: token!, clientId: actor.id, scopes: [], extra: { actor, project } };
  },
  { required: true },
);

// Sin ?project= válido no hay conexión: así nadie mezcla tareas de proyectos distintos.
function scoped(req: Request) {
  const project = new URL(req.url).searchParams.get("project") ?? "";
  if (!k.PROJECT_RE.test(project)) {
    return Response.json(
      { error: "Falta ?project=<nombre> en la URL del MCP (minúsculas, números y guiones). Ej: /api/mcp?project=djesus" },
      { status: 400 },
    );
  }
  return authed(req);
}

export { scoped as GET, scoped as POST, scoped as DELETE };
