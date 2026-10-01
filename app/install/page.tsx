import { headers } from "next/headers";
import { PROJECT_RE } from "@/lib/kanban";
import { Copy } from "./copy";

// Página para humanos: eliges proyecto, copias el mensaje y se lo pegas a Claude Code abierto en la carpeta a conectar.
export const dynamic = "force-dynamic";
export const metadata = { title: "Instalar en Claude Code · Kanban" };

export default async function Install({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const raw = (await searchParams).project?.trim().toLowerCase() ?? "djesus";
  const project = PROJECT_RE.test(raw) ? raw : null;
  const prompt = project && `Conecta esta carpeta al proyecto ${project} del kanban siguiendo ${origin}/install.md?project=${project}`;
  const manual = project && `claude mcp add --transport http --scope local kanban '${origin}/api/mcp?project=${project}' --header "Authorization: Bearer <TOKEN>"`;

  return (
    <main className="doc">
      <a href="/" className="ws"><span className="logo" aria-hidden="true">K</span> Kanban</a>
      <h1>Conecta una carpeta a un proyecto del kanban</h1>
      <p className="muted lead">
        Abre Claude Code <b>en la carpeta que quieres conectar</b> y pégale el mensaje. Solo esa carpeta queda conectada,
        y solo a ese proyecto: el resto de tus carpetas no envía nada al kanban.
      </p>

      <form method="get" className="row-form">
        <label htmlFor="project">Proyecto</label>
        <input id="project" name="project" defaultValue={raw} pattern="[a-z0-9][a-z0-9\-]{0,39}" title="minúsculas, números y guiones" required />
        <button className="secondary">Generar</button>
      </form>
      {!project && <p className="error" role="alert">Nombre de proyecto inválido: usa minúsculas, números y guiones.</p>}

      {prompt && (
        <div className="prompt">
          <code>{prompt}</code>
          <Copy text={prompt} />
        </div>
      )}

      <h2>Qué necesitas</h2>
      <p>Un <b>token de agente</b>: uno de los valores de <code>KANBAN_AGENTS</code> (<code>nombre:token</code>) en Vercel. Claude te lo va a pedir; dale solo la parte después de <code>nombre:</code>.</p>
      <p className="muted">Tu token humano no sirve para esto, y no se lo des nunca a un agente: con él podría aprobar su propio trabajo en tu nombre.</p>

      <h2>Qué va a hacer Claude</h2>
      <ol className="steps">
        <li><b>Preguntarte si esta carpeta</b> (con su ruta exacta) es la que quieres conectar a <code>{project ?? "…"}</code>. No sigue sin tu sí.</li>
        <li><b>Pedirte el token</b> de agente.</li>
        <li><b>Instalar el MCP solo en esta carpeta</b> (<code>--scope local</code>). El token queda en tu configuración privada, no en el repo.</li>
        <li><b>Verificar</b> que <code>claude mcp list</code> muestra <code>kanban ✓ Connected</code>.</li>
        <li><b>Escribir la regla en el <code>CLAUDE.md</code> de esta carpeta</b>: antes de cualquier trabajo busca una tarea del proyecto y, si no existe, la crea y la toma.</li>
        <li><b>Pedirte que reinicies</b> la sesión para que aparezcan las tools.</li>
      </ol>
      <p className="muted">¿Varias carpetas? Repite el proceso dentro de cada una.</p>

      {manual && (
        <>
          <h2>Prefieres hacerlo a mano</h2>
          <p>Desde la carpeta a conectar:</p>
          <div className="prompt">
            <code>{manual}</code>
            <Copy text={manual} />
          </div>
          <p className="muted">Luego añade la regla al <code>CLAUDE.md</code> de esa carpeta. Está en la guía para agentes: <a className="link-u" href={`/install.md?project=${project}`}>/install.md?project={project}</a>.</p>
        </>
      )}
    </main>
  );
}
