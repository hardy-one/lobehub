# Embedded HTML Fragment Rendering — Feature Status

A lab-gated (`lab.enableHtmlRender`, default **off**) feature that renders raw
HTML fragments wrapped in `<!-- html-render-start -->` /
`<!-- html-render-end -->` markers inline in assistant messages, mirroring the
protocol of the well-known "AI Raw HTML Fragment Renderer" userscript
(<https://greasyfork.org/scripts/579427>).

This document records **what has been implemented** and **what has
deliberately not been implemented**, plus the rationale for each decision, so
future maintainers do not re-litigate settled calls or assume gaps are bugs.

---

## Implemented

### Client-side rendering

- **Marker parsing** (`src/features/Conversation/Markdown/plugins/HtmlRender/remarkHtmlRender.ts`)
  — a remark plugin extracts fragments at the mdast level with line-anchored
  marker matching. Streaming (`open` state), indented markers/content,
  one-line merged nodes, blank-line guards (closure-first), and
  prose-marker protection (`isProseMarker`, `looksLikeHtml`) are handled;
  markers and preset share a single source in `packages/const/src/htmlRender.ts`.
- **Seamless inline rendering** (`.../HtmlRender/Render/index.tsx`) — the
  fragment renders **without card chrome** (no border/background/label), so
  the HTML flows directly with the surrounding text. The `HtmlPreview`
  iframe is sandboxed (`allow-scripts allow-forms allow-modals`, no
  `allow-same-origin`) and **auto-sizes to its content** (no height
  constraint is passed, so the auto-height postMessage is not overridden);
  a small borderless "source" button below toggles the raw source.
  While a fragment is still streaming, the component shows the raw source in
  plain DOM and deliberately skips building the iframe document; the
  DOMParser / KaTeX sanitization pass runs once when the fragment closes, so
  per-chunk streaming stays cheap.
- **Virtual-list keep-alive** — a fragment row is kept mounted only while it is
  still generating, or before its iframe height is cached while the row is in
  the viewport. Once the height is cached, historical rows can be recycled
  normally; remounts start from the cached height instead of the 1px default.
- **Sanitizer** — DOM path (`DOMParser` + element removal + attribute sweep)
  and SSR regex fallback (`stripDangerousMarkup`): strips scripts, iframes,
  forms, form controls, remote-resource tags (img/video/audio/source, SVG
  image/use with external refs, style, base), `on*` event attributes
  (incl. SVG/SMIL), `javascript:` URLs (incl. tab/newline obfuscation), and
  CSS `url()`/`expression()`.
- **Lab switch** — `lab.enableHtmlRender` (schema, default, selector, Labs UI
  toggle, i18n en/zh). When off, the plugin is not registered and markers
  are not parsed.
- **Gating** — `useChatMarkdown` filters the plugin registry by the lab
  switch; `HTML_RENDER_TAG` is the single source for the registry tag and the
  gate.

### Server-side / prompt injection

- **Preset** — `HTML_RENDER_PROMPT` (output spec: inline styles, local
  fragments only, no scripts/external resources/event handlers, blank-line
  separation) lives in `@lobechat/const` and is appended to the
  developer/system message when the switch is on, on **both** paths:
  - server context builder (`serverCallLlmContextBuilder.ts` via
    `buildSystemRole`, gated by `preference.lab.enableHtmlRender` resolved at
    operation start and threaded through op metadata);
  - client direct-chat path (`src/services/chat/index.ts`, gated by
    `labPreferSelectors.enableHtmlRender`).
- **Idempotent** — a system role that already contains the start marker is
  not appended a second time.

### Quality

- 113 automated tests (remark 33, Render 15, chat 43, injection 6, labs 12,
  prompt 4), lint clean, type check clean.
- 18 independent review rounds (subagents) with 38 fixes, followed by a
  minimal-implementation review (3 structural simplifications).

---

## Not implemented / Deferred — with rationale

| Item                                                                          | Status                      | Rationale / notes                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PNG export**                                                                | Deferred (v1 cut)           | The reference script ships an html2canvas pipeline (clone, computed-style copy, resource inlining, color-function downgrade, dropdown expansion). Out of scope for the "lightweight rich-text" v1; if needed later, `html-to-image` is the preferred modern replacement.                                       |
| **Declarative interaction protocol** (`data-step`, `data-role`, JSON scripts) | Not implemented (decision)  | The reference script binds button interactions in the host DOM. The product decision was **script-free lightweight rendering** — no interaction protocol at all. The preset explicitly forbids form controls; the client strips them. Model output that includes interactive markup renders as inert elements. |
| **KaTeX rendering inside fragments**                                          | Not implemented             | The reference script auto-renders LaTeX in fragments via CDN KaTeX. Not part of the lightweight scope.                                                                                                                                                                                                         |
| **Server-side heavyweight integration tests**                                 | Not implemented (evaluated) | Mocking `buildServerCallLlmContext` costs more than the wiring it guards (single-line pass-throughs covered by TS contracts + pure-function tests for `buildSystemRole`). Revisit if the wiring grows.                                                                                                         |
| **Scope limiting of preset injection**                                        | Deferred (product decision) | The lab preference is global: the preset is appended to all server LLM calls (including agent\_builder / page / task contexts), where it is noise but harmless. A scope gate can be added if it becomes a problem.                                                                                             |
| **Real-environment smoke test**                                               | **Not done**                | The feature has only automated/AST-level verification. No dev-server run, no end-to-end check with a real model, no visual confirmation of streaming/theme behavior. This is the known gap before release.                                                                                                     |

---

## Known limitations (documented, with preset guidance to avoid)

- Markers inside a paragraph produce a block-level card nested in a `<p>`
  (browsers auto-split; v1 accepted).
- Two fragments with **no blank line** between them collapse into one
  CommonMark HTML block — only the first is parsed. The preset instructs
  blank-line separation.
- A multi-line **text-only** fragment cannot be told apart from prose that
  explains the protocol; multi-line text-only content renders as a fragment
  (single-line path uses an HTML-tag heuristic to skip prose).
- `data:`/`vbscript:` schemes are not blocked (verified non-executable in a
  sandboxed frame in Chromium).
- The preview iframe sandbox allows scripts; the sanitizer is therefore the
  security boundary — it must always run on the DOM path (client-side
  rendering guarantees this).
