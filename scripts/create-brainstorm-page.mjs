#!/usr/bin/env node
/**
 * Crée une sous-page de la page Notion "Brainstorm — Soulforge" à partir
 * d'un fichier markdown simple (titres ##, listes à puces "- ", séparateurs ---,
 * paragraphes).
 *
 * Usage :
 *   node create-brainstorm-page.mjs "<titre de la page>" "<fichier.md>"
 *
 * Variables d'env requises :
 *   NOTION_TOKEN
 *   NOTION_BRAINSTORM_PAGE_ID -> ID de la page "Brainstorm — Soulforge"
 */

import { readFileSync } from "node:fs";

const NOTION_API_KEY = process.env.NOTION_TOKEN;
const PARENT_PAGE_ID = process.env.NOTION_BRAINSTORM_PAGE_ID;

const [title, mdFile] = process.argv.slice(2);

if (!NOTION_API_KEY || !PARENT_PAGE_ID) {
  console.error("Erreur: NOTION_TOKEN et NOTION_BRAINSTORM_PAGE_ID doivent être définis.");
  process.exit(1);
}
if (!title || !mdFile) {
  console.error('Usage: node create-brainstorm-page.mjs "<titre>" "<fichier.md>"');
  process.exit(1);
}

async function notionFetch(path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }
  return res.json();
}

function chunk(text, size = 1900) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts.length ? parts : [text];
}

function richText(text) {
  return chunk(text).map((c) => ({ type: "text", text: { content: c } }));
}

function markdownToBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.trim() === "---") {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText(line.slice(3).trim()) },
      });
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({
        object: "block",
        type: "heading_1",
        heading_1: { rich_text: richText(line.slice(2).trim()) },
      });
      i++;
      continue;
    }
    if (line.startsWith("- ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(line.slice(2).trim()) },
      });
      i++;
      continue;
    }
    // Paragraphe : regroupe les lignes consécutives jusqu'à une ligne vide
    const paragraphLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      lines[i].trim() !== "---" &&
      !lines[i].startsWith("# ") &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("- ")
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: richText(paragraphLines.join("\n")) },
    });
  }
  return blocks;
}

async function main() {
  const markdown = readFileSync(mdFile, "utf-8");
  const children = markdownToBlocks(markdown);

  // L'API Notion limite à 100 blocs par création de page ; on découpe si besoin.
  const firstBatch = children.slice(0, 100);
  const rest = children.slice(100);

  const page = await notionFetch(`/pages`, {
    method: "POST",
    body: JSON.stringify({
      parent: { page_id: PARENT_PAGE_ID },
      properties: {
        title: { title: [{ type: "text", text: { content: title } }] },
      },
      children: firstBatch,
    }),
  });

  for (let i = 0; i < rest.length; i += 100) {
    await notionFetch(`/blocks/${page.id}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: rest.slice(i, i + 100) }),
    });
  }

  console.log(JSON.stringify({ id: page.id, url: page.url }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
