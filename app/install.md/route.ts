// Guía que un agente (Claude Code) lee y ejecuta para instalarse el MCP en UNA carpeta y UN proyecto:
// "Instala el MCP del kanban siguiendo <url>/install.md?project=djesus"
import { PROJECT_RE } from "@/lib/kanban";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("project") ?? "";
  const project = PROJECT_RE.test(p) ? p : null;
  return new Response(doc(url.origin, project), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}

const doc = (origin: string, project: string | null) => {
  const P = project ?? "<PROYECTO>";
  const mcp = `${origin}/api/mcp?project=${P}`;
  return `# Kanban MCP: instalación para Claude Code

Eres un agente instalando este servidor MCP. Sigue los pasos en orden, sin saltarte ninguno.

- Proyecto del kanban: ${project ? `**\`${project}\`**` : "**sin definir**: pregúntale al humano el nombre del proyecto (minúsculas, números y guiones, p.ej. `djesus`) y sustituye `<PROYECTO>` en todos los comandos"}
- Servidor MCP: \`${mcp}\`
- Tablero web (solo humanos): ${origin}/?p=${P}

El kanban está dividido por proyectos. Esta instalación conecta **solo la carpeta actual** con **solo el proyecto \`${P}\`**. Nunca instales el MCP para todos los proyectos (\`--scope user\`) ni escribas la regla en \`~/.claude/CLAUDE.md\`: el humano decide carpeta por carpeta qué se conecta.

## 1. Confirma la carpeta y el proyecto

Ejecuta \`pwd\` y pregúntale al humano, citando la ruta exacta:

> ¿Conecto la carpeta \`<ruta>\` al proyecto \`${P}\` del kanban? Lo que hagas aquí quedará registrado en ese tablero.

- Espera un **sí explícito**. Si dice que no, o que es otra carpeta, para. No continúes desde otra ruta por tu cuenta.
- Si la carpeta es parte de un repo git, usa la raíz del repo (\`git rev-parse --show-toplevel\`) y confírmala igual.
- Si el humano quiere conectar varias carpetas, repite toda esta guía dentro de cada una.

## 2. Consigue un token de agente

Pídele al humano un **token de agente**. Es uno de los valores de \`KANBAN_AGENTS\` (\`nombre:token\`) configurados en Vercel; solo se usa la parte después de \`nombre:\`.

- No inventes tokens. Si no lo tienes, pregunta y espera.
- Un token **humano** no sirve aquí (el MCP devuelve 401). Nunca pidas ni uses un token humano.
- No escribas el token en archivos que se suban a git.

## 3. Instala el servidor solo en esta carpeta

Desde la carpeta confirmada:

\`\`\`bash
claude mcp add --transport http --scope local kanban '${mcp}' --header "Authorization: Bearer <TOKEN>"
\`\`\`

\`--scope local\` hace que el servidor exista solo cuando Claude Code se abre en esta carpeta, y el token queda en tu configuración privada, no en el repo.

Si ya existía una entrada \`kanban\` en esta carpeta, ejecuta primero \`claude mcp remove kanban --scope local\`.

## 4. Verifica

\`\`\`bash
claude mcp list
\`\`\`

Tiene que aparecer \`kanban: ${mcp} (HTTP) - ✓ Connected\`.

- **401**: el token es incorrecto o es humano. Pide otro.
- **400**: falta \`?project=\` o el nombre no es válido. Revisa la URL del paso 3.

Las tools aparecen en la siguiente sesión de Claude Code abierta en esta carpeta. Díselo al humano.

No des la instalación por terminada si \`claude mcp list\` no muestra \`✓ Connected\` **ejecutado desde esta carpeta**: con \`--scope local\`, el servidor solo existe en la ruta donde lo instalaste.

## 5. Obligatorio: deja la regla en el CLAUDE.md de esta carpeta

Añade este bloque al \`CLAUDE.md\` de la carpeta confirmada (la raíz del repo), **no** al global. Si el humano no quiere subirlo a git, usa \`CLAUDE.local.md\` en la misma carpeta. Crea el archivo si no existe, y si ya hay una sección \`## Kanban\`, reemplázala en vez de duplicarla.

\`\`\`markdown
## Kanban (obligatorio): proyecto \`${P}\`
**PRIMERA ACCIÓN, SIEMPRE.** Todo trabajo en esta carpeta se registra en el MCP \`kanban\`, proyecto \`${P}\` (${origin}/?p=${P}). Esto aplica a cualquier pedido que implique código, investigar, configurar o documentar, por pequeño que sea; solo quedan exentas las preguntas puramente conversacionales. No leas ni edites archivos del pedido antes de completar los pasos 1–3.
0. Al empezar la sesión: \`list_tasks\` con \`mine: true\` para retomar tus tareas en curso.
1. Busca si ya existe una tarea para eso: \`list_tasks\` con \`q\` = palabras clave del pedido (prueba 2-3 variantes; incluye \`status: "done"\` por si ya se hizo).
2. Si existe y está libre, tómala con \`claim_task\` y lee su historial con \`get_task\`. Si la tiene otro agente, no la dupliques: coméntale o pregunta al humano.
3. Si no existe, créala con \`create_task\` (título claro, criterios de aceptación en Markdown, \`role\` si aplica) y tómala con \`claim_task\`.
4. Mientras trabajas, deja notas con \`add_note\`: \`progress\` (avances), \`decision\` (enfoque elegido y por qué), \`blocker\`, \`question\` (dudas para el humano) y \`handoff\` (antes de soltar la tarea). Renuevan tu lease de 30 min.
5. Al terminar: \`submit_for_review\` con un resumen verificable en Markdown (qué cambió, dónde, cómo probarlo).
6. Si te bloqueas: \`update_task\` con status=blocked y una nota, o \`release_task\`.
7. Revisa con \`review_task\` el trabajo de otros agentes, nunca el tuyo.
No registres en el kanban trabajo de otras carpetas o proyectos. Si el MCP \`kanban\` no está conectado, avisa al humano antes de empezar.
\`\`\`

## 6. Primera comprobación

Si las tools \`kanban\` ya están disponibles en esta sesión, aplica la regla ahora mismo a la tarea que te pidieron (busca y, si no hay, crea la tarea). Si no lo están porque falta reiniciar, díselo al humano: la regla se aplicará en la próxima sesión abierta en esta carpeta.

## Cómo funciona

\`backlog → ready → in_progress → review → human_review → done\` (más \`blocked\`)

| Tool | Para qué |
|---|---|
| \`list_tasks\` | Buscar tareas del proyecto: \`q\` (palabras clave), \`mine: true\`, \`status\`, \`role\`. Úsalo antes de empezar cualquier trabajo |
| \`get_task\` | Tarea completa con su historial (comentarios, handoffs, revisiones) |
| \`claim_task\` | Tomar una tarea (atómico). Sin \`id\` toma la siguiente por prioridad. Sobre tu propia tarea renueva el lease |
| \`add_note\` | Nota tipada: \`progress\`, \`decision\`, \`blocker\`, \`question\` (pide respuesta humana), \`handoff\` |
| \`comment\` | Mensaje para otro agente o humano |
| \`update_task\` | Editar campos o mover a backlog/ready/blocked |
| \`release_task\` | Devolver la tarea a ready con una nota |
| \`submit_for_review\` | Entregar con un resumen verificable |
| \`review_task\` | \`approve\` o \`request_changes\` sobre trabajo ajeno |
| \`create_task\` | Crear tareas o subtareas (quedan en el proyecto de esta conexión) |

Reglas que el servidor hace cumplir:

- Cada conexión solo ve y toca tareas de su proyecto.
- Nadie revisa su propio trabajo.
- Las tareas en \`human_review\` solo las aprueba un humano desde la web.
- Si dejas de dar señales durante 30 min, otro agente puede tomar tu tarea.
- Si te piden cambios, la tarea vuelve a ti en \`in_progress\`. Lee el comentario con \`get_task\` antes de seguir.
`;
};
