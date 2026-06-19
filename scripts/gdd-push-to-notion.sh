#!/usr/bin/env bash
# gdd-push-to-notion.sh
# Pousse une proposition de mise à jour GDD (fichier .md) vers une page
# Notion dédiée "Sync GDD", sous forme de blocs ajoutés en bas de page.
#
# Pré-requis :
#   - Créer une intégration interne sur https://www.notion.so/my-integrations
#   - Partager la page "Sync GDD" avec cette intégration (bouton "..." > Connexions)
#   - Renseigner NOTION_TOKEN et NOTION_SYNC_PAGE_ID (voir .env.example)
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <proposal-file.md>"
  exit 1
fi

PROPOSAL_FILE="$1"

if [ ! -f "$PROPOSAL_FILE" ]; then
  echo "Fichier introuvable : $PROPOSAL_FILE" >&2
  exit 1
fi

if [ -z "${NOTION_TOKEN:-}" ] || [ -z "${NOTION_SYNC_PAGE_ID:-}" ]; then
  echo "Erreur : variables NOTION_TOKEN et NOTION_SYNC_PAGE_ID requises." >&2
  echo "Voir .env.example pour la procédure de création de l'intégration Notion." >&2
  exit 1
fi

CONTENT=$(cat "$PROPOSAL_FILE")

BLOCKS_JSON=$(python3 - "$CONTENT" <<'PYEOF'
import sys, json, textwrap

content = sys.argv[1]
paragraphs = [p for p in content.split("\n\n") if p.strip()]
blocks = []

def add_paragraph(text):
    for chunk in textwrap.wrap(text, 1900, break_long_words=False, replace_whitespace=False) or [text]:
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": chunk}}]}
        })

for p in paragraphs:
    if p.startswith("## "):
        blocks.append({
            "object": "block",
            "type": "heading_3",
            "heading_3": {"rich_text": [{"type": "text", "text": {"content": p[3:].strip()[:1900]}}]}
        })
    elif p.startswith("# "):
        blocks.append({
            "object": "block",
            "type": "heading_2",
            "heading_2": {"rich_text": [{"type": "text", "text": {"content": p[2:].strip()[:1900]}}]}
        })
    elif p.strip() == "---":
        blocks.append({"object": "block", "type": "divider", "divider": {}})
    else:
        add_paragraph(p)

print(json.dumps(blocks))
PYEOF
)

RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "https://api.notion.com/v1/blocks/${NOTION_SYNC_PAGE_ID}/children" \
  -H "Authorization: Bearer ${NOTION_TOKEN}" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  --data "{\"children\": ${BLOCKS_JSON}}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Erreur Notion (HTTP $HTTP_CODE) :" >&2
  echo "$BODY" | python3 -m json.tool >&2 2>/dev/null || echo "$BODY" >&2
  exit 1
fi

echo "✅ Proposition poussée vers la page Notion de sync."
echo "   Relis-la dans Notion et intègre manuellement les parties validées dans ton GDD principal."
