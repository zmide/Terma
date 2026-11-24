import { escapeHtml } from '../../shared/html-escape';

const RELEASE_TEXT_LIMIT = 12_000;
const RELEASE_HISTORY_LIMIT = 10;

export interface ReleaseNoteSource {
  version?: string;
  published_at?: string;
  notes?: string;
}

interface ReleaseHistorySource {
  release_notes?: ReleaseNoteSource[];
  latest_version?: string;
  published_at?: string;
  notes?: string;
}

export interface ReleaseNoteEntry {
  version: string;
  published: string;
  markdown: string;
}

function safeUpdateMarkdownUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    const fragment = String(value || "").trim();
    return /^#[\p{L}\p{N}_-]+$/u.test(fragment) ? fragment : "";
  }
}

function updateMarkdownInlineHtml(value: string) {
  const tokens: string[] = [];
  const placeholder = (html: string) => {
    const index = tokens.push(html) - 1;
    return `\uE000${index}\uE001`;
  };
  let source = String(value || "");
  source = source.replace(/`([^`\n]+)`/g, (_, code) => placeholder(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const safe = safeUpdateMarkdownUrl(href);
    return safe ? placeholder(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`) : match;
  });
  let html = escapeHtml(source)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");
  return html.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] || "");
}

export function updateMarkdownHtml(value: unknown, displayedVersion = "", fallback = "") {
  const lines = String(value || fallback).slice(0, RELEASE_TEXT_LIMIT).replace(/\r\n?/g, "\n").split("\n");
  const normalizedVersion = String(displayedVersion || "").trim().replace(/^v/i, "").toLowerCase();
  if (normalizedVersion) {
    const firstContentIndex = lines.findIndex(line => line.trim());
    const firstHeading = firstContentIndex >= 0 ? /^#{1,6}\s+(.+?)\s*$/.exec(lines[firstContentIndex].trim()) : null;
    const headingVersion = String(firstHeading?.[1] || "").trim().replace(/^\[|\]$/g, "").replace(/^v/i, "").toLowerCase();
    if (firstHeading && headingVersion === normalizedVersion) lines.splice(firstContentIndex, 1);
  }
  const result: string[] = [];
  let paragraph: string[] = [];
  let list = "";
  const closeList = () => {
    if (!list) return;
    result.push(`</${list}>`);
    list = "";
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    result.push(`<p>${updateMarkdownInlineHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    closeList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*<!--(?:[\s\S]*?)-->\s*$/.test(line)) continue;
    if (/^\s*<a\b[^>]*\bid\s*=\s*["'][^"']+["'][^>]*>\s*<\/a>\s*$/i.test(line)) continue;
    if (/^```/.test(line.trim())) {
      flushBlocks();
      const code = [];
      for (index += 1; index < lines.length && !/^```/.test(lines[index].trim()); index += 1) code.push(lines[index]);
      result.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flushBlocks();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushBlocks();
      const level = Math.min(6, heading[1].length + 3);
      result.push(`<h${level}>${updateMarkdownInlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushBlocks();
      result.push("<hr>");
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const listItem = unordered ?? /^\s*\d+\.\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const nextList = unordered ? "ul" : "ol";
      if (list && list !== nextList) closeList();
      if (!list) {
        list = nextList;
        result.push(`<${list}>`);
      }
      result.push(`<li>${updateMarkdownInlineHtml(listItem[1])}</li>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushBlocks();
      result.push(`<blockquote>${updateMarkdownInlineHtml(quote[1])}</blockquote>`);
      continue;
    }
    closeList();
    paragraph.push(line.trim());
  }
  flushBlocks();
  return result.join("");
}

export function localizedUpdateReleaseMarkdown(value: unknown, locale: string, unavailable: string) {
  const source = String(value || "").trim();
  if (!source) return "";
  const requestedLanguage = locale.toLowerCase().startsWith("en") ? "en" : "zh";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const languageHeadings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(lines[index].trim());
    if (!heading) continue;
    const label = heading[1].replace(/<[^>]+>/g, "").trim().toLowerCase();
    const language = /^(?:english|en(?:-us)?)(?:\s+version)?$/.test(label)
      ? "en"
      : /^(?:简体中文|中文|zh(?:-cn)?|chinese)(?:\s+version)?$/.test(label)
        ? "zh"
        : "";
    if (language) languageHeadings.push({index, language});
  }
  const selected = languageHeadings.find(item => item.language === requestedLanguage);
  if (selected) {
    const next = languageHeadings.find(item => item.index > selected.index);
    const localized = lines.slice(selected.index + 1, next?.index ?? lines.length).join("\n").trim();
    if (localized) return localized;
  }
  if (requestedLanguage === "en" && /[\u3400-\u9fff]/.test(source)) {
    return unavailable;
  }
  return source;
}

export function releaseNotesPlan(source: ReleaseHistorySource | null, locale: string, unavailable: string) {
  const history = Array.isArray(source?.release_notes) && source.release_notes.length
    ? source.release_notes.slice(0, RELEASE_HISTORY_LIMIT)
    : source?.notes ? [{ version: source.latest_version, published_at: source.published_at, notes: source.notes }] : [];
  const entries = history.map(item => ({
    version: String(item?.version || '').replace(/^v/i, ''),
    published: item?.published_at || '',
    notes: localizedUpdateReleaseMarkdown(item?.notes, locale, unavailable).slice(0, RELEASE_TEXT_LIMIT)
  }));
  return { entries, locale, key: entries.length ? JSON.stringify([locale, entries]) : '' };
}

export function nextReleaseNotesFrame(): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 50);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
    }
  });
}

export async function renderReleaseNotes(
  plan: ReturnType<typeof releaseNotesPlan>, fallback: string, current: () => boolean, pause?: () => Promise<void>
): Promise<ReleaseNoteEntry[] | null> {
  const rendered: ReleaseNoteEntry[] = [];
  for (const item of plan.entries) {
    if (pause) await pause();
    if (!current()) return null;
    rendered.push({
      version: item.version,
      published: item.published ? new Date(item.published).toLocaleDateString(plan.locale) : '',
      markdown: updateMarkdownHtml(item.notes, item.version, fallback)
    });
  }
  return current() ? rendered : null;
}
