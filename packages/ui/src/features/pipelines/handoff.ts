/**
 * Provider-neutral adaptation of mattpocock/skills' handoff contract.
 * Code Engine owns this contract; pipeline models do not install or invoke it.
 * https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md
 */
export const PIPELINE_HANDOFF_SCHEMA_VERSION = 1 as const;

export const PIPELINE_HANDOFF_REQUIRED_SECTIONS = [
  "## Summary",
  "## Details",
  "## Artifacts",
  "## Blockers",
  "## Suggested skills",
] as const;

export const PIPELINE_HANDOFF_RESPONSE_INSTRUCTION = [
  "Return only one compact Markdown handoff document for downstream stages.",
  "Start with `# Handoff: <stage name>` and include `## Summary`, `## Details`, `## Artifacts`, `## Blockers`, and `## Suggested skills`.",
  "Reference existing files, specs, plans, commits, diffs, issues, or URLs instead of duplicating their contents.",
  "Redact secrets, credentials, and personally identifiable information.",
  "List only optional skills that would materially help the next stage; write `None` when there are no useful suggestions.",
  "Keep skill suggestions advisory: the next stage must use them only when they are available and independently appropriate for its assigned objective.",
  "Do not perform or claim work assigned to another stage.",
].join(" ");

const DEFAULT_SECTION_CONTENT: Record<typeof PIPELINE_HANDOFF_REQUIRED_SECTIONS[number], string> = {
  "## Summary": "See the stage result recorded above.",
  "## Details": "No additional details were reported.",
  "## Artifacts": "None reported.",
  "## Blockers": "None reported.",
  "## Suggested skills": "None reported.",
};

function safeStageName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Pipeline stage";
}

interface MarkdownStructure {
  firstContentLine: string | null;
  headings: Set<string>;
}

function markdownStructure(markdown: string): MarkdownStructure {
  const headings = new Set<string>();
  let firstContentLine: string | null = null;
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.split("\n")) {
    if (firstContentLine === null && line.trim()) firstContentLine = line.trim();
    const fenceLine = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceLine) {
      const marker = fenceLine[1][0] as "`" | "~";
      if (!fence) {
        fence = { marker, length: fenceLine[1].length };
      } else if (
        marker === fence.marker &&
        fenceLine[1].length >= fence.length &&
        !fenceLine[2].trim()
      ) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (heading) headings.add(`${heading[1]} ${heading[2]}`);
  }

  return { firstContentLine, headings };
}

function hasDocumentTitle(structure: MarkdownStructure): boolean {
  return /^# Handoff(?::|\s).*$/i.test(structure.firstContentLine ?? "");
}

function replaceDocumentTitle(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const index = lines.findIndex((line) => Boolean(line.trim()));
  if (index >= 0) lines[index] = title;
  return lines.join("\n");
}

/**
 * Turn any provider's terminal response into Code Engine's canonical handoff
 * document. Providers are prompted to return this format directly, while this
 * normalizer guarantees the contract for adapters or models that do not.
 */
export function createPipelineHandoffDocument(stageName: string, response: string): string {
  const title = `# Handoff: ${safeStageName(stageName)}`;
  const normalized = response.replace(/\r\n?/g, "\n").trim();
  const sourceStructure = markdownStructure(normalized);
  const hasAnySection = PIPELINE_HANDOFF_REQUIRED_SECTIONS.some(
    (heading) => sourceStructure.headings.has(heading),
  );

  let document = hasAnySection ? normalized : [
    title,
    "## Summary",
    normalized || "No stage result was reported.",
  ].join("\n\n");
  if (hasAnySection && hasDocumentTitle(sourceStructure)) {
    document = replaceDocumentTitle(document, title);
  } else if (hasAnySection) {
    document = `${title}\n\n${document}`;
  }

  const documentStructure = markdownStructure(document);
  for (const heading of PIPELINE_HANDOFF_REQUIRED_SECTIONS) {
    if (documentStructure.headings.has(heading)) continue;
    document += `\n\n${heading}\n\n${DEFAULT_SECTION_CONTENT[heading]}`;
  }

  return document.trim();
}

export function isPipelineHandoffDocument(value: string): boolean {
  const structure = markdownStructure(value.trim());
  return hasDocumentTitle(structure) &&
    PIPELINE_HANDOFF_REQUIRED_SECTIONS.every((heading) => structure.headings.has(heading));
}
