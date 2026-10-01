import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Status } from "@/lib/kanban";

export const LABEL: Record<Status, string> = {
  backlog: "Backlog", ready: "Por hacer", in_progress: "En curso", blocked: "Bloqueado",
  review: "Revisión", human_review: "Revisión humana", done: "Hecho",
};
export const POLICY_LABEL = { agent_then_human: "Agente → humano", human: "Solo humano", agent: "Solo agente" };
export const key = (id: number) => `KAN-${id}`;

// Círculos estilo Linear: el relleno indica cuánto avanzó la tarea.
const FILL: Partial<Record<Status, number>> = { in_progress: 0.5, review: 0.75, human_review: 0.75 };
export function StatusIcon({ status }: { status: Status }) {
  const c = `var(--st-${status})`;
  return (
    <svg className="ico" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {status === "done" ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === "blocked" ? (
        <>
          <circle cx="7" cy="7" r="6.5" fill={c} />
          <path d="M4.5 7h5" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="5.75" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray={status === "backlog" ? "2 2" : undefined} />
          {FILL[status] && (
            <circle cx="7" cy="7" r="2.5" fill="none" stroke={c} strokeWidth="5" transform="rotate(-90 7 7)"
              strokeDasharray={`${FILL[status]! * 2 * Math.PI * 2.5} 100`} />
          )}
          {status === "human_review" && <circle cx="7" cy="7" r="1.6" fill="var(--surface)" />}
        </>
      )}
    </svg>
  );
}

export function PriorityIcon({ p }: { p: number }) {
  if (p === 0) {
    return (
      <svg className="ico" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label="Urgente">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--urgent)" />
        <path d="M7 4v3.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="10" r=".9" fill="#fff" />
      </svg>
    );
  }
  const on = 4 - p; // P1 = 3 barras, P3 = 1
  return (
    <svg className="ico" width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={`Prioridad P${p}`}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="1" fill={i < on ? "var(--muted)" : "var(--line-strong)"} />
      ))}
    </svg>
  );
}

// "agent:claude" → cuadrado (agente) | "human:maikol" → círculo (humano)
export function Avatar({ id, size = 20 }: { id: string | null; size?: number }) {
  if (!id) {
    return <span className="avatar empty" style={{ width: size, height: size }} title="Sin asignar" />;
  }
  const [kind, name] = id.split(":");
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={`avatar ${kind}`} title={`${name} (${kind === "agent" ? "agente" : "humano"})`}
      style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${h} 42% 40%)` }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export const who = (id: string) => id.split(":")[1] ?? id;

export function Md({ children }: { children: string }) {
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}

export function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short" });
}
