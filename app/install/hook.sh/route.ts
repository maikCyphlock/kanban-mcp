// Hook PreToolUse de Claude Code: bloquea Edit/Write si el agente no tiene una tarea en curso.
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  return new Response(script(origin), { headers: { "content-type": "text/x-shellscript; charset=utf-8" } });
}

const script = (origin: string) => `#!/usr/bin/env bash
# kanban-guard: Claude Code no edita archivos sin una tarea en curso en ${origin}
# Token de agente en ~/.claude/kanban-token (o variable KANBAN_TOKEN).
TOKEN="\${KANBAN_TOKEN:-$(cat ~/.claude/kanban-token 2>/dev/null)}"
[ -n "$TOKEN" ] || { echo "kanban-guard: falta ~/.claude/kanban-token, no se verificó la tarea" >&2; exit 0; }

# ponytail: si el servidor no responde se deja pasar (no bloquear trabajo offline)
res=$(curl -s -m 5 -w '\\n%{http_code}' -H "Authorization: Bearer $TOKEN" "${origin}/api/me") || exit 0
code=\${res##*$'\\n'}
body=\${res%$'\\n'*}
[ "$code" = 200 ] || { echo "kanban-guard: el servidor respondió $code (¿token inválido?), no se verificó la tarea" >&2; exit 0; }

case "$body" in
  *'"active":[]'*)
    echo "Bloqueado por el kanban: no tienes ninguna tarea en curso. Antes de editar archivos: busca con list_tasks (q = palabras clave del pedido); si existe, tómala con claim_task; si no, créala con create_task y tómala con claim_task." >&2
    exit 2 ;;
esac
exit 0
`;
