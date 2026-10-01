import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as k from "@/lib/kanban";
import { AutoRefresh } from "./auto-refresh";
import { Avatar, LABEL, Md, POLICY_LABEL, PriorityIcon, StatusIcon, ago, key, who } from "./ui";

// Web = canal exclusivo de humanos. Aquí se hace la revisión humana.
export const dynamic = "force-dynamic";

const COOKIE = "kanban_token";
const COLUMNS: k.Status[] = ["backlog", "ready", "in_progress", "blocked", "review", "human_review", "done"];
const MOVABLE = ["backlog", "ready", "blocked"] as const;
type Search = { error?: string; t?: string; f?: string; new?: string; p?: string };

async function me() {
  return k.actorFromToken("human", (await cookies()).get(COOKIE)?.value);
}

async function login(fd: FormData) {
  "use server";
  const token = String(fd.get("token") ?? "");
  if (!k.actorFromToken("human", token)) redirect("/?error=Token+inválido");
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

async function logout() {
  "use server";
  (await cookies()).delete(COOKIE);
  redirect("/");
}

async function act(fd: FormData) {
  "use server";
  const actor = await me();
  if (!actor) redirect("/");
  const s = (n: string) => String(fd.get(n) ?? "").trim();
  const id = Number(s("id"));
  const ret = s("ret");
  const q = new URLSearchParams(ret.startsWith("/?") ? ret.slice(2) : "");
  q.delete("error");
  try {
    switch (s("op")) {
      case "create": {
        const t = await k.createTask(actor, {
          project: s("project"), title: s("title"), description: s("description"), priority: Number(s("priority")),
          role: s("role") || undefined, review_policy: s("review_policy") as k.Policy, status: "ready",
        });
        q.delete("new");
        q.set("t", String(t.id));
        break;
      }
      case "props": {
        const { task } = await k.getTask(id);
        const p: Parameters<typeof k.updateTask>[2] = {};
        if (s("status") && s("status") !== task.status) p.status = s("status") as (typeof MOVABLE)[number];
        if (Number(s("priority")) !== task.priority) p.priority = Number(s("priority"));
        if (s("role") !== (task.role ?? "")) p.role = s("role");
        if (s("review_policy") !== task.review_policy) p.review_policy = s("review_policy") as k.Policy;
        await k.updateTask(actor, id, p);
        break;
      }
      case "approve": await k.reviewTask(actor, id, "approve", s("body")); break;
      case "request_changes": await k.reviewTask(actor, id, "request_changes", s("body")); break;
      case "comment":
        if (s("body")) await k.comment(actor, id, s("body"), s("mode") === "note" ? (s("note_type") as k.NoteType) : undefined);
        break;
      case "claim": await k.claimTask(actor, { id }); break;
      case "submit": await k.submitForReview(actor, id, s("body") || "(sin resumen)"); break;
    }
  } catch (e) {
    q.set("error", (e as Error).message);
  }
  revalidatePath("/");
  redirect(`/?${q}`);
}

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const actor = await me();
  if (!actor) return <Login error={sp.error} />;

  const proj = sp.p && k.PROJECT_RE.test(sp.p) ? sp.p : undefined;
  const [open, done, events, projects] = await Promise.all([
    k.listTasks({ project: proj }), k.listTasks({ status: "done", project: proj }), k.recentEvents(1000), k.projects(),
  ]);
  if (proj && !projects.includes(proj)) projects.push(proj);
  const all = [...open, ...done.slice(0, 30)];
  const byTask = Map.groupBy(events.toSorted((a, b) => a.id - b.id), (e) => e.task_id);
  const asked = new Set(all.filter((t) => k.pendingQuestion(byTask.get(t.id) ?? [])).map((t) => t.id));
  const waiting = open.filter((t) => t.status === "human_review").length;
  const mineCount = open.filter((t) => t.assignee === actor.id).length;

  const f = sp.f === "review" || sp.f === "mine" || sp.f === "questions" ? sp.f : undefined;
  const tasks = all.filter((t) =>
    f === "review" ? t.status === "review" || t.status === "human_review" : f === "mine" ? t.assignee === actor.id : f === "questions" ? asked.has(t.id) : true);
  const columns = f ? COLUMNS.filter((c) => tasks.some((t) => t.status === c)) : COLUMNS;
  const nav = (o: { f?: string; p?: string }) => `/?${new URLSearchParams({ ...(o.p && { p: o.p }), ...(o.f && { f: o.f }) })}`;
  const href = (extra: Record<string, string> = {}) => `/?${new URLSearchParams({ ...(proj && { p: proj }), ...(f && { f }), ...extra })}`;
  const ret = `/?${new URLSearchParams(Object.entries(sp).filter(([n]) => n !== "error") as [string, string][])}`;
  const detail = sp.t ? await k.getTask(Number(sp.t)).catch(() => null) : null;

  return (
    <div className="app">
      <AutoRefresh />
      <aside className="side">
        <div className="ws"><span className="logo" aria-hidden="true">K</span> Kanban</div>
        <nav aria-label="Vistas">
          <a href={nav({ p: proj })} aria-current={!f ? "page" : undefined}>
            <svg className="ico" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2.5h3v9H2zM5.5 2.5h3v6h-3zM9 2.5h3v4H9z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
            Tablero <span className="count">{open.length}</span>
          </a>
          <a href={nav({ p: proj, f: "review" })} aria-current={f === "review" ? "page" : undefined}>
            <StatusIcon status="human_review" /> Revisión
            {waiting > 0 && <span className="badge" title="Esperan revisión humana">{waiting}</span>}
          </a>
          <a href={nav({ p: proj, f: "mine" })} aria-current={f === "mine" ? "page" : undefined}>
            <Avatar id={actor.id} size={14} /> Mis tareas <span className="count">{mineCount}</span>
          </a>
          <a href={nav({ p: proj, f: "questions" })} aria-current={f === "questions" ? "page" : undefined}>
            <svg className="ico" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5.4 5.6a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.1M7 10.1v.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            Preguntas {asked.size > 0 ? <span className="badge ask" title="Preguntas de agentes sin responder">{asked.size}</span> : <span className="count">0</span>}
          </a>
        </nav>
        <nav aria-label="Proyectos">
          <div className="side-label">Proyectos</div>
          <a href={nav({ f })} aria-current={!proj ? "page" : undefined}><span className="dot" aria-hidden="true" /> Todos</a>
          {projects.map((x) => (
            <a key={x} href={nav({ f, p: x })} aria-current={proj === x ? "page" : undefined}>
              <span className="dot" aria-hidden="true" style={{ background: `hsl(${[...x].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)} 55% 50%)` }} /> {x}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <Avatar id={actor.id} size={22} />
          <span className="grow">{actor.name}</span>
          <form action={logout}><button className="ghost sm">Salir</button></form>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <h1>{proj && <span className="muted">{proj} › </span>}{f === "review" ? "Revisión" : f === "mine" ? "Mis tareas" : f === "questions" ? "Preguntas" : "Tablero"}</h1>
          {waiting > 0 && f !== "review" && (
            <a className="pill" href={nav({ p: proj, f: "review" })}><StatusIcon status="human_review" /> {waiting} esperando revisión humana</a>
          )}
          {asked.size > 0 && f !== "questions" && (
            <a className="pill ask" href={nav({ p: proj, f: "questions" })}>{asked.size} {asked.size === 1 ? "pregunta" : "preguntas"} sin responder</a>
          )}
          <span className="grow" />
          <a className="btn primary" href={href({ new: "1" })}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            Nueva tarea
          </a>
        </header>

        <div className="board">
          {columns.map((status) => {
            const col = tasks.filter((t) => t.status === status);
            return (
              <section key={status} className="col" aria-label={LABEL[status]}>
                <h2><StatusIcon status={status} /> {LABEL[status]} <span className="count">{col.length}</span></h2>
                {col.map((t) => {
                  const stale = t.status === "in_progress" && t.lease_until != null && t.lease_until < Date.now();
                  const n = (byTask.get(t.id) ?? []).filter((e) => e.kind === "comment" || e.kind.startsWith("note:")).length;
                  return (
                    <a key={t.id} className={`card${String(t.id) === sp.t ? " sel" : ""}`} href={href({ t: String(t.id) })}>
                      <div className="card-top"><span className="key">{key(t.id)}</span><Avatar id={t.assignee} size={18} /></div>
                      <div className="card-title">{t.title}</div>
                      <div className="card-meta">
                        <PriorityIcon p={t.priority} />
                        {!proj && <span className="chip proj">{t.project}</span>}
                        {t.role && <span className="chip">{t.role}</span>}
                        {stale && <span className="chip warn">lease vencido</span>}
                        {asked.has(t.id) && <span className="chip ask">pregunta</span>}
                        {n > 0 && <span className="meta-n" title={`${n} comentarios`}>
                          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2.5h8v5.5H5L2.5 10V8H2z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>{n}
                        </span>}
                      </div>
                    </a>
                  );
                })}
              </section>
            );
          })}
        </div>
      </main>

      {(detail || sp.new) && (
        <>
          <a className="scrim" href={href()} aria-label="Cerrar panel" />
          <section className="panel" aria-label="Detalle">
            {sp.error && <div className="toast" role="alert">{sp.error}</div>}
            {detail ? <Detail {...detail} actor={actor} ret={ret} close={href()} /> : <NewTask ret={ret} close={href()} projects={projects} project={proj} />}
          </section>
        </>
      )}
      {sp.error && !detail && !sp.new && <div className="toast floating" role="alert">{sp.error}</div>}
    </div>
  );
}

function PanelHead({ crumb, close }: { crumb: string; close: string }) {
  return (
    <header className="panel-head">
      <span className="muted">Kanban</span><span className="muted">›</span><span>{crumb}</span>
      <span className="grow" />
      <a className="icon-btn" href={close} aria-label="Cerrar">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </a>
    </header>
  );
}

function Detail({ task: t, events, actor, ret, close }: { task: k.Task; events: k.Event[]; actor: k.Actor; ret: string; close: string }) {
  const mine = t.assignee === actor.id;
  const reviewable = (t.status === "review" || t.status === "human_review") && !mine;
  const submitted = events.findLast((e) => e.kind === "submitted");
  return (
    <>
      <PanelHead crumb={key(t.id)} close={close} />
      <div className="panel-body">
        <article className="content">
          <h2 className="title">{t.title}</h2>
          {t.description ? <Md>{t.description}</Md> : <p className="muted">Sin descripción.</p>}
          <KeyNotes events={events} status={t.status} />

          {reviewable && (
            <div className={`review-box ${t.status}`}>
              <StatusIcon status={t.status} />
              <div>
                <b>{t.status === "human_review" ? "Esperando tu revisión humana" : "Esperando revisión"}</b>
                <div className="muted">Enviado por {who(t.assignee ?? "")}{submitted && ` · ${ago(submitted.created_at)}`}. Revisa el resumen en el chatter y decide abajo.</div>
              </div>
            </div>
          )}

          <Chatter t={t} events={events} reviewable={reviewable} mine={mine} ret={ret} />
        </article>

        <aside className="props">
          <form action={act} className="props-form">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="ret" value={ret} />
            <input type="hidden" name="op" value="props" />
            <label>Estado
              <select name="status" defaultValue={t.status}>
                {!MOVABLE.includes(t.status as never) && <option value={t.status} disabled>{LABEL[t.status]}</option>}
                {MOVABLE.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
              </select>
            </label>
            <label>Prioridad
              <select name="priority" defaultValue={String(t.priority)}>
                <option value="0">Urgente</option><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option>
              </select>
            </label>
            <label>Rol<input name="role" defaultValue={t.role ?? ""} placeholder="cualquiera" /></label>
            <label>Revisión
              <select name="review_policy" defaultValue={t.review_policy}>
                {Object.entries(POLICY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <button className="secondary">Guardar</button>
          </form>
          <dl>
            <dt>Proyecto</dt><dd><a className="link-u" href={`/?p=${t.project}`}>{t.project}</a></dd>
            <dt>Asignado</dt>
            <dd><Avatar id={t.assignee} size={18} /> {t.assignee ? who(t.assignee) : "Nadie"}</dd>
            <dt>Creado por</dt><dd><Avatar id={t.created_by} size={18} /> {who(t.created_by)}</dd>
            <dt>Creado</dt><dd>{ago(t.created_at)}</dd>
            <dt>Actualizado</dt><dd>{ago(t.updated_at)}</dd>
            {t.lease_until && t.status === "in_progress" && (
              <><dt>Lease</dt><dd>{t.lease_until < Date.now() ? <span className="warn-text">vencido</span> : `vence ${ago(2 * Date.now() - t.lease_until).replace("hace", "en")}`}</dd></>
            )}
          </dl>
          {t.status === "ready" && (
            <form action={act}>
              <input type="hidden" name="id" value={t.id} /><input type="hidden" name="ret" value={ret} />
              <button name="op" value="claim" className="secondary wide">Tomar tarea</button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

const KIND: Record<string, { text: string; tone?: string }> = {
  created: { text: "creó la tarea" },
  claimed: { text: "tomó la tarea" },
  released: { text: "liberó la tarea" },
  updated: { text: "actualizó la tarea" },
  submitted: { text: "envió a revisión", tone: "info" },
  agent_approved: { text: "aprobó como agente", tone: "ok" },
  approved: { text: "aprobó", tone: "ok" },
  changes_requested: { text: "pidió cambios", tone: "warn" },
};

const NOTE: Record<k.NoteType, { label: string; tone: string }> = {
  progress: { label: "Avance", tone: "info" },
  decision: { label: "Decisión", tone: "purple" },
  blocker: { label: "Bloqueo", tone: "err" },
  question: { label: "Pregunta", tone: "warn" },
  handoff: { label: "Relevo", tone: "teal" },
};
const noteType = (e: k.Event) => (e.kind.startsWith("note:") ? (e.kind.slice(5) as k.NoteType) : null);
const group = (e: k.Event) => (e.kind === "comment" ? "msg" : noteType(e) ? "note" : "act");

const FIELD: Record<string, (v: unknown) => string> = {
  title: (v) => `Título: ${v}`,
  description: () => "Descripción actualizada",
  priority: (v) => `Prioridad: P${v}`,
  role: (v) => `Rol: ${v || "cualquiera"}`,
  review_policy: (v) => `Revisión: ${POLICY_LABEL[v as k.Policy] ?? v}`,
};

const dayLabel = (ms: number) => {
  const d = new Date(ms).toDateString();
  if (d === new Date().toDateString()) return "Hoy";
  if (d === new Date(Date.now() - 86400000).toDateString()) return "Ayer";
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "long" });
};

// Lo que un humano necesita saber sin leer todo el hilo: pregunta pendiente, última decisión, bloqueo y relevo.
function KeyNotes({ events, status }: { events: k.Event[]; status: k.Status }) {
  const q = k.pendingQuestion(events);
  const last = (t: k.NoteType) => events.findLast((e) => e.kind === `note:${t}`);
  const items = [
    q && { e: q, t: "question" as const, extra: "sin responder" },
    status === "blocked" || status === "in_progress" ? (() => { const b = last("blocker"); return b && { e: b, t: "blocker" as const }; })() : null,
    (() => { const d = last("decision"); return d && { e: d, t: "decision" as const }; })(),
    (() => { const h = last("handoff"); return h && { e: h, t: "handoff" as const }; })(),
  ].filter(Boolean) as { e: k.Event; t: k.NoteType; extra?: string }[];
  if (!items.length) return null;
  return (
    <section className="keynotes" aria-label="Notas clave">
      {items.map(({ e, t, extra }) => (
        <div key={e.id} className={`keynote ${NOTE[t].tone}`}>
          <div className="msg-head">
            <span className={`tag ${NOTE[t].tone}`}>{NOTE[t].label}</span>
            {extra && <b>{extra}</b>}
            <span className="muted">{who(e.actor)} · {ago(e.created_at)}</span>
          </div>
          <Md>{e.body}</Md>
          {t === "question" && <div className="muted small">Respóndela con un mensaje o nota en el chatter.</div>}
        </div>
      ))}
    </section>
  );
}

// Chatter estilo Odoo: "Enviar mensaje" / "Registrar nota", filtros, hilo más reciente primero,
// separadores por día y seguimiento "Estado anterior → nuevo". Filtros y pestañas son CSS puro (:has).
function Chatter({ t, events, reviewable, mine, ret }: { t: k.Task; events: k.Event[]; reviewable: boolean; mine: boolean; ret: string }) {
  let prev: k.Status | null = null;
  const items = events.map((e) => {
    const from = prev;
    if (e.status) prev = e.status;
    return { e, from };
  }).reverse();
  const people = [...new Set(events.map((e) => e.actor))];
  const pending = k.pendingQuestion(events);
  const count = (g: string) => events.filter((e) => group(e) === g).length;
  const filters = [["all", "Todo", events.length], ["msg", "Mensajes", count("msg")], ["note", "Notas", count("note")], ["act", "Actividad", count("act")]] as const;

  return (
    <section className="chatter" aria-label="Chatter">
      <div className="chatter-bar">
        <div className="filters" role="radiogroup" aria-label="Filtrar historial">
          {filters.map(([v, l, n]) => (
            <label key={v} className="filter">
              <input type="radio" name={`cf-${t.id}`} value={v} className={`cf-${v}`} defaultChecked={v === "all"} />
              {l} <span className="count">{n}</span>
            </label>
          ))}
        </div>
        <span className="grow" />
        <span className="followers" title={people.map(who).join(", ")}>
          {people.slice(0, 5).map((p) => <Avatar key={p} id={p} size={20} />)}
          <span className="muted">{people.length}</span>
        </span>
      </div>

      <form action={act} className="composer">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="ret" value={ret} />
        <div className="composer-tabs">
          <label className="ctab"><input type="radio" name="mode" value="msg" defaultChecked /> Enviar mensaje</label>
          <label className="ctab"><input type="radio" name="mode" value="note" /> Registrar nota</label>
          <select name="note_type" className="note-type" defaultValue="progress" aria-label="Tipo de nota">
            {k.NOTE_TYPES.map((n) => <option key={n} value={n}>{NOTE[n].label}</option>)}
          </select>
        </div>
        <textarea name="body" rows={3} aria-label="Mensaje"
          placeholder={pending ? "Responde la pregunta del agente (Markdown)…" : reviewable ? "Comentario de revisión (Markdown)…" : mine && t.status === "in_progress" ? "Mensaje, nota o resumen para la revisión (Markdown)…" : "Escribe un mensaje o una nota (Markdown)…"} />
        <div className="composer-row">
          <span className="hint">Markdown: **negrita**, `código`, - listas, [enlaces](url)</span>
          <span className="grow" />
          {reviewable && <button name="op" value="request_changes" className="warn">Pedir cambios</button>}
          {reviewable && <button name="op" value="approve" className="ok">Aprobar</button>}
          {mine && t.status === "in_progress" && <button name="op" value="submit" className="secondary">Enviar a revisión</button>}
          <button name="op" value="comment" className={reviewable ? "secondary" : "primary"}>Enviar</button>
        </div>
      </form>

      <ol className="thread">
        {items.map(({ e, from }, i) => {
          const day = dayLabel(e.created_at);
          const showDay = i === 0 || dayLabel(items[i - 1].e.created_at) !== day;
          const nt = noteType(e);
          const k2 = KIND[e.kind];
          let fields: string[] = [];
          let note = "";
          if (e.kind === "updated") {
            try {
              const { note: n, status: _s, ...rest } = JSON.parse(e.body);
              note = n ?? "";
              fields = Object.entries(rest).map(([f, v]) => FIELD[f]?.(v) ?? f);
            } catch {}
          }
          const body = e.kind === "updated" ? note : e.body;
          return [
            showDay && <li key={`d${e.id}`} className="day-li"><div className="day"><span>{day}</span></div></li>,
            <li key={e.id} className={`g-${group(e)}`}>
              <div className={`msg ${e.kind === "comment" ? "comment" : nt ? `note ${NOTE[nt].tone}` : "log"}`}>
                <Avatar id={e.actor} size={28} />
                <div className="msg-main">
                  <div className="msg-head">
                    <b>{who(e.actor)}</b>
                    <span className="muted">{e.actor.startsWith("agent:") ? "agente" : "humano"}</span>
                    <span className="muted">· {ago(e.created_at)}</span>
                    {nt && <span className={`tag ${NOTE[nt].tone}`}>{NOTE[nt].label}</span>}
                    {nt === "question" && pending?.id === e.id && <span className="tag warn solid">sin responder</span>}
                    {k2 && <span className={`tag ${k2.tone ?? ""}`}>{k2.text}</span>}
                  </div>
                  {e.status && from !== e.status && (
                    <div className="track">
                      {from && <><StatusIcon status={from} /> {LABEL[from]} <span className="arrow" aria-label="a">→</span></>}
                      <StatusIcon status={e.status} /> <b>{LABEL[e.status]}</b>
                      <span className="muted">(Estado)</span>
                    </div>
                  )}
                  {fields.map((x) => <div key={x} className="track"><span className="arrow">→</span> {x}</div>)}
                  {body && <Md>{body}</Md>}
                </div>
              </div>
            </li>,
          ];
        })}
      </ol>
    </section>
  );
}

function NewTask({ ret, close, projects, project }: { ret: string; close: string; projects: string[]; project?: string }) {
  return (
    <>
      <PanelHead crumb="Nueva tarea" close={close} />
      <form action={act} className="new-task">
        <input type="hidden" name="op" value="create" />
        <input type="hidden" name="ret" value={ret} />
        <input name="title" className="title-input" placeholder="Título de la tarea" aria-label="Título" required autoFocus />
        <textarea name="description" rows={10} aria-label="Descripción"
          placeholder={"Descripción en Markdown…\n\n## Criterios de aceptación\n- [ ] …"} />
        <div className="composer-row">
          <select name="priority" defaultValue="2" aria-label="Prioridad">
            <option value="0">Urgente</option><option value="1">Alta</option><option value="2">Media</option><option value="3">Baja</option>
          </select>
          <input name="project" list="projects-list" defaultValue={project ?? ""} placeholder="Proyecto" aria-label="Proyecto"
            required pattern="[a-z0-9][a-z0-9\-]{0,39}" title="minúsculas, números y guiones" />
          <datalist id="projects-list">{projects.map((x) => <option key={x} value={x} />)}</datalist>
          <input name="role" placeholder="Rol (opcional)" aria-label="Rol" />
          <select name="review_policy" defaultValue="agent_then_human" aria-label="Revisión">
            {Object.entries(POLICY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="grow" />
          <button className="primary">Crear tarea</button>
        </div>
      </form>
    </>
  );
}

function Login({ error }: { error?: string }) {
  return (
    <main className="login">
      <span className="logo big" aria-hidden="true">K</span>
      <h1>Entrar al Kanban</h1>
      <p className="muted">Usa tu token humano. Los tokens de agente solo funcionan por MCP: <a className="link-u" href="/install">conectar Claude Code</a>.</p>
      <form action={login}>
        <label htmlFor="token" className="sr-only">Token humano</label>
        <input id="token" name="token" type="password" placeholder="Token humano" required autoComplete="current-password" />
        <button className="primary wide">Entrar</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
