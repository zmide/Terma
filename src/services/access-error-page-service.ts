import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { publicErrorBody } from "../public-error";

const { PUBLIC_DIR } = require("../config");
const { secureHeaders } = require("../security");
const resources = new Map<string, any>();

function text(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[character]!));
}

export function accessErrorLanguage(request: IncomingMessage): string {
  const url = new URL(request.url || "/", "http://terma.invalid");
  const selected = url.searchParams.get("terma_access_language");
  if (["zh-CN", "en-US"].includes(selected || "")) return selected!;
  const preferred = String(request.headers["accept-language"] || "en").split(",")
    .map((item, index) => ({language:item.split(";")[0].trim(), quality:Number(item.match(/;\s*q=([0-9.]+)/)?.[1] ?? 1), index}))
    .filter(item => item.quality > 0).sort((left, right) => right.quality - left.quality || left.index - right.index);
  return preferred[0]?.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function rejectHostRequest(request: IncomingMessage, response: ServerResponse): void {
  const language = accessErrorLanguage(request);
  if (!resources.has(language)) resources.set(language, JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "locales", language, "errors.json"), "utf8")));
  const locale = resources.get(language);
  const host = String(request.headers.host || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256);
  const pathname = new URL(request.url || "/", "http://terma.invalid").pathname;
  const commonHeaders = {"Cache-Control":"no-store", "Vary":"Accept, Accept-Language"};
  if (pathname.startsWith("/api/") || String(request.headers.accept || "").includes("application/json")) {
    const body = JSON.stringify(publicErrorBody("HOST_NOT_ALLOWED", locale.backend.host_not_allowed, {host}));
    response.writeHead(421, secureHeaders({...commonHeaders, "Content-Type":"application/json; charset=utf-8", "Content-Length":Buffer.byteLength(body)}));
    response.end(body);
    return;
  }
  const copy = locale.access_page;
  const nonce = crypto.randomBytes(18).toString("base64");
  const style = `body{margin:0;min-height:100dvh;padding:24px;box-sizing:border-box;display:grid;place-items:center;background:#f4f6f8;color:#1f2933;font:15px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}.card{box-sizing:border-box;max-width:640px;width:100%;padding:32px;border:1px solid #d6dde3;border-radius:12px;background:#fff;box-shadow:0 12px 32px #0f172014}h1{margin:0 0 12px;font-size:25px;line-height:1.35}p{margin:12px 0}code{display:block;overflow-wrap:anywhere;padding:12px;border-radius:6px;background:#eef2f6;font:13px ui-monospace,monospace}ol{padding-left:22px}li{margin:10px 0}.muted{color:#64748b}.languages{display:flex;gap:18px;margin-top:24px}a{color:#2563eb}a:focus-visible{outline:2px solid currentColor;outline-offset:4px}@media(max-width:480px){body{padding:16px}.card{padding:22px}h1{font-size:22px}}@media(prefers-color-scheme:dark){body{background:#111827;color:#e5e7eb}.card{background:#1f2937;border-color:#475569}code{background:#111827}.muted{color:#b4c0d0}a{color:#93c5fd}}`;
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${text(copy.title)} · Terma</title><style nonce="${nonce}">${style}</style></head><body><main class="card"><p class="muted">Terma · 421 · HOST_NOT_ALLOWED</p><h1>${text(copy.title)}</h1><p>${text(copy.description)}</p><code>${text(host)}</code><ol><li>${text(copy.local_access)}</li><li>${text(copy.allow_host)}</li><li>${text(copy.proxy_hint)}</li></ol><p class="muted">${text(copy.listen_hint)}</p><nav class="languages" aria-label="Language"><a href="/?terma_access_language=zh-CN" lang="zh-CN">简体中文</a><a href="/?terma_access_language=en-US" lang="en-US">English</a></nav></main></body></html>`;
  response.writeHead(421, secureHeaders({...commonHeaders, "Content-Type":"text/html; charset=utf-8", "Content-Length":Buffer.byteLength(html),
    "Content-Security-Policy":`default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`}));
  response.end(html);
}
