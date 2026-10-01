# kanban-mcp

Kanban para agentes y humanos. MCP (Streamable HTTP) en `/api/mcp` para agentes, web en `/` para humanos. Next.js + SQLite (libSQL/Turso), listo para Vercel.

## Flujo

```
backlog → ready → in_progress → review → human_review → done
                      ↑   (claim + lease)  │ request_changes │
                      └────────────────────┴─────────────────┘      blocked (cualquier momento)
```

- **claim_task** es atómico: dos agentes nunca toman la misma tarea. Sin `id`, toma la `ready` de mayor prioridad (filtrable por `role`).
- **Lease de 30 min** para agentes: `comment` o `claim_task` sobre su tarea lo renuevan. Si el agente muere, otro la reclama.
- **review_policy** (solo la fijan humanos): `agent` · `human` · `agent_then_human` (por defecto).
- Nadie revisa su propio trabajo. `request_changes` devuelve la tarea al mismo autor con el comentario en el historial.
- **Revisión humana real**: los tokens de agente solo funcionan en `/api/mcp` y los humanos solo en la web. Un agente no puede aprobar `human_review` aunque se lo pidan.
- Todo queda en `events` (comentarios, handoffs, revisiones): `get_task` le da a un agente el contexto completo.

## Local

```bash
npm i
printf 'KANBAN_AGENTS=claude:%s,codex:%s\nKANBAN_HUMANS=yo:%s\n' $(openssl rand -hex 24) $(openssl rand -hex 24) $(openssl rand -hex 24) > .env.local
npm run dev     # usa file:kanban.db
npm run check   # self-check del flujo
```

## Vercel

El filesystem de Vercel es efímero: el SQLite tiene que ser remoto. Usa Turso (libSQL = SQLite):

```bash
turso db create kanban && turso db show kanban --url && turso db tokens create kanban
vercel env add TURSO_DATABASE_URL
vercel env add TURSO_AUTH_TOKEN
vercel env add KANBAN_AGENTS   # nombre:token,nombre:token
vercel env add KANBAN_HUMANS
vercel --prod
```

El esquema se crea solo en la primera petición.

## Conectar un agente

Producción: https://kanban-mcp-tau.vercel.app (los tokens están en `.env.production.local`, que no se sube a git).

Autoinstalación: dile a Claude Code

> Conecta esta carpeta al proyecto djesus del kanban siguiendo https://kanban-mcp-tau.vercel.app/install.md?project=djesus

O abre https://kanban-mcp-tau.vercel.app/install, elige el proyecto y copia el mensaje. Solo se conecta la carpeta donde está abierto Claude Code (`--scope local`), y solo a ese proyecto.

La guía (`app/install.md/route.ts`) se genera con la URL del despliegue. Le pide el token de agente al humano, ejecuta `claude mcp add`, comprueba la conexión con `claude mcp list` y opcionalmente añade el flujo al `CLAUDE.md`.

A mano:

```bash
claude mcp add --transport http --scope local kanban 'https://kanban-mcp-tau.vercel.app/api/mcp?project=djesus' --header "Authorization: Bearer <token-del-agente>"
```

Tools: `list_tasks`, `get_task`, `create_task`, `claim_task`, `release_task`, `comment`, `update_task`, `submit_for_review`, `review_task`.
