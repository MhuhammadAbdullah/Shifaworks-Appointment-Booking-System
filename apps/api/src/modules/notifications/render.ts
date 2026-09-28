/**
 * Template rendering (Handlebars, isolated instance).
 *
 * Safety rules, enforced by validateTemplate() when templates are saved and
 * re-checked when rendering:
 *  - only the variables listed for the template's key may be used;
 *  - only {{#if}} / {{#unless}} blocks; no partials, other helpers or
 *    sub-expressions;
 *  - no raw output ({{{x}}} / {{& x}}): customer-supplied values such as
 *    names are always HTML-escaped in the email body.
 * The subject line renders in "text" mode (no HTML escaping — it is not
 * markup); the body renders in "html" mode.
 */
import Handlebars from "handlebars";
import { TEMPLATE_VARIABLES, type EmailTemplateKey } from "@booking/shared";

type AstNode = { type: string; [k: string]: unknown };
type Vars = Record<string, string>;

const hbs = Handlebars.create();
const COMPILE_OPTIONS = { strict: false, knownHelpersOnly: true, knownHelpers: { if: true, unless: true } } as const;
const BLOCK_HELPERS = new Set(["if", "unless"]);

export class TemplateError extends Error {}

/** Returns human-readable problems; empty when the template is safe to use. */
export function validateTemplate(source: string, key: EmailTemplateKey): string[] {
  const allowed = new Set(TEMPLATE_VARIABLES[key]);
  const errors = new Set<string>();
  let ast: AstNode;
  try {
    ast = hbs.parse(source) as unknown as AstNode;
  } catch (err) {
    return [`Template syntax error: ${(err as Error).message.split("\n")[0]}`];
  }

  const checkPath = (node: AstNode | undefined) => {
    if (!node) return;
    if (node.type !== "PathExpression") {
      if (node.type === "SubExpression") errors.add("Nested helpers are not supported");
      return; // literals are fine
    }
    const name = String(node.original);
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) errors.add(`Unsupported expression {{${name}}}`);
    else if (!allowed.has(name)) errors.add(`Unknown variable {{${name}}}`);
  };

  const walk = (node: AstNode | undefined | null): void => {
    if (!node) return;
    switch (node.type) {
      case "Program":
        for (const s of node.body as AstNode[]) walk(s);
        return;
      case "ContentStatement":
      case "CommentStatement":
        return;
      case "MustacheStatement": {
        if (node.escaped === false) errors.add("Raw output ({{{ }}}) is not allowed; use {{ }}");
        if ((node.params as AstNode[]).length || (node.hash as unknown)) errors.add("Helpers are not supported in {{ }}");
        checkPath(node.path as AstNode);
        return;
      }
      case "BlockStatement": {
        const helper = String((node.path as AstNode).original);
        if (!BLOCK_HELPERS.has(helper)) {
          errors.add(`Only {{#if}} and {{#unless}} blocks are supported (found {{#${helper}}})`);
          return;
        }
        const params = node.params as AstNode[];
        if (params.length !== 1) errors.add(`{{#${helper}}} needs exactly one variable`);
        params.forEach(checkPath);
        walk(node.program as AstNode);
        walk(node.inverse as AstNode | null);
        return;
      }
      default:
        errors.add(`Unsupported template feature (${node.type})`);
    }
  };
  walk(ast);
  return [...errors];
}

const caches = { html: new Map<string, HandlebarsTemplateDelegate>(), text: new Map<string, HandlebarsTemplateDelegate>() };

function compiled(source: string, mode: "html" | "text"): HandlebarsTemplateDelegate {
  const cache = caches[mode];
  let fn = cache.get(source);
  if (!fn) {
    fn = hbs.compile(source, { ...COMPILE_OPTIONS, noEscape: mode === "text" });
    if (cache.size > 500) cache.clear();
    cache.set(source, fn);
  }
  return fn;
}

/** Renders one template string. Throws TemplateError for unsafe/invalid templates. */
export function renderTemplate(source: string, key: EmailTemplateKey, vars: Vars, mode: "html" | "text"): string {
  const errors = validateTemplate(source, key);
  if (errors.length) throw new TemplateError(errors.join("; "));
  // Only known keys are passed in, as own properties; prototype access is off by default in Handlebars 4.6+.
  const data: Vars = {};
  for (const v of TEMPLATE_VARIABLES[key]) data[v] = vars[v] ?? "";
  return compiled(source, mode)(data).trim();
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'", "&#x60;": "`", "&#x3D;": "=", "&nbsp;": " " };

/** Plain-text alternative of an email body (links kept as "label (url)"). */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) => (label.trim() === href.trim() ? href : `${label} (${href})`))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|nbsp|#x27|#39|#x60|#x3D);/g, (e) => ENTITIES[e] ?? e)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escapeHtml = (s: string) => hbs.Utils.escapeExpression(s);

/** Wraps a rendered email fragment in a simple, client-safe layout. */
export function emailLayout(orgName: string, bodyHtml: string): string {
  const org = escapeHtml(orgName);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #e4e4e7;font-size:18px;font-weight:bold">${org}</td></tr>
<tr><td style="padding:20px 24px;font-size:15px;line-height:1.55">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a">This message was sent by ${org} about your booking.</td></tr>
</table></td></tr></table></body></html>`;
}
