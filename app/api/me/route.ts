import * as k from "@/lib/kanban";

// Lo usa el hook guardián: ¿este agente tiene alguna tarea en curso?
export async function GET(req: Request) {
  const me = k.actorFromToken("agent", req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!me) return Response.json({ error: "token de agente inválido" }, { status: 401 });
  const active = await k.listTasks({ status: "in_progress", assignee: me.id });
  return Response.json({ agent: me.name, active: active.map((t) => ({ id: t.id, title: t.title })) });
}
