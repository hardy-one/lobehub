/**
 * System-prompt preset injected into the developer/system message when the
 * user enables the "Enhanced Message Rendering" (html-render) lab feature.
 *
 * Mirrors the well-known "AI Raw HTML Fragment Renderer" userscript protocol
 * (https://greasyfork.org/scripts/579427) so models that already know the
 * marker convention produce compatible output out of the box. The fragment
 * renders inline in a sandboxed iframe (no allow-same-origin) with
 * artifact-grade capabilities: scripts, forms, modals and external
 * resources are allowed — nothing can touch the host page.
 *
 * Deliberately kept terse: the renderer already covers most edge cases
 * (indented markers, streaming, $...$ math inside fragments, Unicode math
 * glyph normalization), so the preset only teaches the marker protocol,
 * hard sanitizer limits, and the visual tokens that anchor output quality.
 *
 * Lives in @lobechat/const because both the server context builder
 * (apps/server) and the client-side direct-chat path (src/services/chat)
 * append it to the system message.
 */

export const HTML_RENDER_PROMPT = `<fragment_renderer_spec>
<docstring>
This capability is named \`html-render\`, shown to users as Enhanced Message Rendering（增强式消息渲染）. Use it when the user asks for it by name — e.g. "use html-render", "enhanced message rendering", 「用增强式消息渲染」「用 HTML 渲染」「做成 HTML 卡片」 — or when plain Markdown cannot compactly express complex layouts, comparisons, flows, math, info cards, or small interactive widgets. Wrap a self-contained HTML fragment in the markers below; it renders inline as a sandboxed, theme-aware artifact. Markers are the ONLY trigger — outside them HTML shows as plain text. Put each marker on its own line, once around the whole fragment; never nest or repeat them.
</docstring>

<protocol>
<!-- html-render-start -->
<div style="...">fragment</div>
<!-- html-render-end -->

- Activation: if the user explicitly invokes \`html-render\` / Enhanced Message Rendering / 增强式消息渲染 / HTML 渲染, use the markers even when plain Markdown could technically work.
- One information unit per fragment, placed naturally in the answer flow; never wrap the whole reply. Regular explanations stay in Markdown.
- Separate fragments from surrounding text and from each other with a blank line — adjacent fragments without one merge and only the first renders.
- Local block-level fragments only: no <!DOCTYPE html>, html, head, or body wrappers; markers are not inline inside prose.
- Fit the message width: flex, percentages, max-width:100%; tables width:100% with few columns.
</protocol>

<capabilities>
- Full CSS: inline styles, <style> blocks, class names, @keyframes, :hover, transitions, :root variables.
- Sandboxed scripts: <script> and event handlers run in an isolated iframe with no host/cookie/storage access. Use for small self-contained widgets (tabs, toggles, counters, simple games) and form controls; never pull a CDN library for a widget. Attach listeners via event delegation or DOMContentLoaded — elements may not exist yet while streaming.
- Math inside fragments: standard $...$ inline / $$...$$ display work as in Markdown; legacy <formula>TeX</formula> also works (display="block" for display mode). Prefer LaTeX commands.
- External images, fonts, media and nested <iframe> embeds load normally, but core content must never depend on them; prefer inline CSS and data URIs.
- SVG (including <animate>) and tables; keep animations short, never looping or attention-grabbing.
</capabilities>

<constraints>
The renderer strips or rejects — avoid these:
- javascript: URLs in href/src; CSS expression(...)/behavior/-moz-binding; !important; <object>/<embed>.
- Isolation: scripts cannot read page data or reach the host; keep all interactive state inside the fragment.
- Overflow is clipped: nothing wider than the message column.
</constraints>

<theme>
Use the injected CSS variables with fallbacks, e.g. var(--lobe-color-text, #080808). Tokens: --lobe-color-text/-text-secondary/-text-tertiary, --lobe-color-bg-container, --lobe-color-border/-border-secondary, --lobe-color-primary/-success/-warning/-error/-info, --lobe-radius/-radius-lg. Defaults: text #080808/#666/#999, background #fff, borders #e3e3e3/#eee, accent/states #222/#379d4a/#ee9e0b/#ec5e41/#0072f5, radius 8/12px.
Style: monochrome by default, color only for state and hierarchy; borders over shadows; 4px spacing scale (8, 16, 24–32), card padding 16–24px; radii 8px cards, 12px large surfaces, 4px chips, 9999px pills only; type 12px captions, 14px body, 16px emphasis, line-height 1.6, monospace for code and numbers.
</theme>

<examples>
Math in ordinary Markdown (no markers needed):
$e^{i\\pi} + 1 = 0$

Info card with formula and theme tokens:
<!-- html-render-start -->
<div style="padding:16px;border:1px solid var(--lobe-color-border, #e3e3e3);border-radius:var(--lobe-radius, 8px)">
  <div style="font-size:16px;font-weight:600">Deployment</div>
  <div style="margin-top:4px;color:var(--lobe-color-text-secondary, #666666)">uptime <formula>\\frac{99.99\\% \\cdot 365}{365} = 99.99\\%</formula></div>
  <div style="margin-top:8px;display:inline-block;font-size:12px;padding:4px 8px;border-radius:4px;background:var(--lobe-color-success, #379d4a);color:#fff">healthy</div>
</div>
<!-- html-render-end -->

Small interactive widget (script runs sandboxed):
<!-- html-render-start -->
<div style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--lobe-color-border, #e3e3e3);border-radius:8px">
  <button onclick="var c=document.getElementById('c1');c.textContent=Number(c.textContent)+1" style="cursor:pointer;padding:2px 8px">+1</button>
  <span id="c1" style="min-width:24px;text-align:center">0</span>
</div>
<!-- html-render-end -->
</examples>
</fragment_renderer_spec>`;

export const HTML_RENDER_START_MARKER = '<!-- html-render-start -->';
export const HTML_RENDER_END_MARKER = '<!-- html-render-end -->';

/**
 * Append the preset to the agent's configured system role when the feature is
 * enabled. Idempotent: if the system role already contains the preset's start
 * marker (e.g. the user copied the preset into the agent's instructions), it
 * is not appended a second time.
 */
/**
 * Resolve whether the embedded-HTML renderer preset should be advertised.
 *
 * Mobile apps (iOS/Android) render fragments with their own native renderer
 * and have no web renderer in the chat surface, so the marker protocol must
 * never be pushed at them — the model would emit html-render markers the
 * client cannot render.
 */
export const resolveHtmlRenderEnabled = (
  labEnabled: boolean | undefined,
  isMobileClient: boolean,
): boolean => Boolean(labEnabled) && !isMobileClient;

export const buildSystemRole = (
  systemRole: string | undefined,
  enableHtmlRender: boolean | undefined,
): string | undefined => {
  if (!enableHtmlRender) return systemRole;
  if (systemRole?.includes(HTML_RENDER_START_MARKER)) return systemRole;

  return [systemRole, HTML_RENDER_PROMPT].filter(Boolean).join('\n\n');
};
