'use client';

import { theme } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import katex from 'katex';
import renderMathInElement from 'katex/contrib/auto-render';
import katexCss from 'katex/dist/katex.min.css?inline';
import { Code2, Eye } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MarkdownElementProps } from '../../type';
import { registerHtmlRenderCopySource } from './copyBridge';
import { KATEX_FONT_FACES } from './katexFonts';

/**
 * Last known iframe height per message id. The virtualized message list
 * unmounts rows that scroll out of view and remounts them on return; without
 * a cached starting height the fresh iframe would start at defaultHeight (1px)
 * and the auto-height postMessage would snap it to the real height a frame
 * later — a double layout change that makes virtua re-measure the row and
 * jolts the scrollbar mid-scroll.
 */
export const iframeHeightCache = new Map<string, number>();

/**
 * Last known preview width per message id, mirroring the height cache. The
 * width reporter only runs once the iframe has reached its final height, so a
 * cached value lets virtual-list remounts (and source/preview toggles) start
 * already hugging the content instead of flashing the full message column.
 */
export const iframeWidthCache = new Map<string, number>();

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 6px;

    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  container: css`
    /* Anchors the source-mode floating action (a sibling of the <pre>) to
       the code box corner; the preview-mode toggle anchors to previewWrap. */
    position: relative;
    margin-block: 8px;

    /* Reveal the floating toggles when the mouse enters the preview/source
       area. Half-opaque on area hover so the toggle never hides content;
       fully opaque only while hovering the toggle itself. */
    &:hover .html-render-floating-action {
      opacity: 0.45;
    }
  `,
  // Wraps the fragment iframe; the width is driven by the in-iframe reporter
  // so the wrapper (and the floating action pinned to its corner) hugs the
  // fragment's actual width instead of spanning the whole message column.
  previewWrap: css`
    position: relative;
    display: inline-block;
    width: 100%;
    max-width: 100%;
  `,
  // Floating pill for the preview/source toggle, revealed on hover / focus
  // (like the markdown table copy button). The literal
  // html-render-floating-action class is the hook for the container's hover
  // rule (antd-style class names are hashed and cannot be referenced across
  // template literals).
  floatingAction: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 4px;
    inset-inline-end: 4px;

    padding: 2px;
    border-radius: ${cssVar.borderRadiusLG};

    opacity: 0;

    transition: opacity 0.2s ${cssVar.motionEaseOut};

    &:hover,
    &:focus-within {
      opacity: 1;
    }
  `,
  source: css`
    margin: 0;
    padding: 10px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

interface HtmlRenderProps extends MarkdownElementProps {
  /** set by the remark plugin — true while the fragment is still streaming */
  open?: boolean;
}

/**
 * Elements removed before the fragment is injected. Everything else is
 * allowed — scripts, forms, media, external resources and nested iframes
 * run inside the sandboxed iframe (allow-scripts allow-forms allow-modals,
 * no allow-same-origin), mirroring the artifact HTML preview. Only legacy
 * plugin containers stay removed: dead tech with native-code risk.
 */
const REMOVE_SELECTORS = 'object, embed';

/**
 * Matches `javascript:` URLs in href/src — executable on click/load. Browsers
 * strip tab/newline characters while parsing URL schemes, so those are
 * removed before matching (e.g. `java&#x9;script:` decodes to `java\tscript:`
 * and still executes).
 */
const JAVASCRIPT_URL_REGEX = /^\s*javascript:/i;
/** Strips tab/newline the way the browser URL parser does. */
const stripUrlWhitespace = (value: string): string => value.replaceAll(/[\t\n\r]/g, '');
/**
 * Matches legacy executable CSS values. External url() / @import are allowed
 * now (the fragment may load remote resources like the artifact preview);
 * only IE-era executable constructs are still dropped.
 */
const STYLE_FORBIDDEN_VALUE = /expression\s*\(|behavior\s*:|-moz-binding/i;
/**
 * Filter <style> element contents with the same value blacklist: external
 * resources (@import / url()) and executable legacy CSS are removed, while
 * local SVG references (url(#id)) and all ordinary rules stay. This is what
 * makes in-fragment stylesheets safe inside the sandboxed iframe.
 */
export const sanitizeStyleElement = (styleEl: HTMLElement): void => {
  const css = styleEl.textContent || '';
  if (STYLE_FORBIDDEN_VALUE.test(css)) {
    // drop the whole element — a stylesheet smuggling executable legacy CSS
    // is not worth keeping any of
    styleEl.remove();
  }
};

export const sanitizeStyleValue = (value: string): string => {
  if (!value) return '';
  return value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      const colon = decl.indexOf(':');
      if (colon <= 0) return false;
      const val = decl.slice(colon + 1).trim();
      // a declaration carrying legacy executable CSS or !important is
      // dropped on its own; sibling declarations survive (!important could
      // override the preview's own typography/layout rules). The forbidden
      // pattern is tested on the full declaration (property name included:
      // `behavior: url(...)` is a property, not a value).
      if (STYLE_FORBIDDEN_VALUE.test(decl) || /!important/i.test(val)) return false;
      return true;
    })
    .join(';');
};
/** URL-carrying attributes that could reference a javascript: URI. */
const URL_ATTRS = ['href', 'src', 'xlink:href'];

/**
 * Defense-in-depth attribute pass. Event handlers are allowed (scripts run
 * in the sandbox), but `javascript:` URLs in href/src are still dropped —
 * they are an accidental-execution footgun. Inline styles keep their value
 * filter (!important / legacy executable CSS).
 */
const stripExecutableAttributes = (root: Element | Document): void => {
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      const lower = name.toLowerCase();
      if (URL_ATTRS.includes(lower) && JAVASCRIPT_URL_REGEX.test(stripUrlWhitespace(attr.value))) {
        el.removeAttribute(name);
      } else if (lower === 'style') {
        // Whitelist-filter the declaration list instead of dropping the whole
        // attribute — allowed properties survive, anything else is stripped.
        const kept = sanitizeStyleValue(attr.value);
        if (kept) el.setAttribute('style', kept);
        else el.removeAttribute('style');
      }
    }
  });
};

/**
 * Regex fallback used only where DOMParser is unavailable (SSR). Mirrors the
 * DOM path: drop plugin containers, javascript: URLs and legacy executable
 * CSS. Note this fallback is defense-in-depth only — the app renders
 * messages client-side, where the DOM path always runs.
 */
export const stripDangerousMarkup = (rawHtml: string): string =>
  rawHtml
    .replaceAll(/<(object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replaceAll(/<(object|embed)\b[^>]*>/gi, '')
    .replaceAll(
      /\s+(?:href|src|xlink:href)\s*=\s*(?:"\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:[^"]*"|'\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:[^']*'|j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:[^\s>]+)/gi,
      '',
    )
    .replaceAll(/\s+style\s*=\s*("[^"]*expression\s*\([^"]*"|'[^']*expression\s*\([^']*')/gi, '');

/**
 * Styles injected into the preview document. The fragment iframe is
 * display-only: its root never scrolls (overflowing content is clipped) so no
 * scrollbar ever appears and wheel events chain through to the host message
 * list. `body` becomes a BFC (flow-root) so child margins cannot collapse out
 * of it — the height script measures the body box, which must include margins.
 */
/**
 * The KaTeX stylesheet ships @font-face blocks with relative font paths
 * (url(fonts/KaTeX_*.woff2)) that cannot resolve inside a srcdoc iframe —
 * they would 404 against the host origin and shadow the data-URI faces
 * below in the FontFaceSet. Strip them; KATEX_FONT_FACES re-declares every
 * face with inline fonts.
 */
const KATEX_FONT_FACE_REGEX = /@font-face\s*\{[^}]*\}/g;

const PREVIEW_STYLE =
  '<style>' +
  'html,body{margin:0;padding:0;background:transparent;color-scheme:light dark}' +
  'html,body{overflow:hidden}' +
  'body{display:flow-root;font-family:var(--lobe-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif);font-size:var(--lobe-font-size,14px);line-height:var(--lobe-line-height,1.6);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}' +
  '*{scrollbar-width:none}' +
  '*::-webkit-scrollbar{display:none}' +
  '</style>' +
  // KaTeX stylesheet for <formula> math (bundled, no external requests);
  // its own @font-face blocks are stripped (relative paths cannot resolve
  // in a srcdoc document — KATEX_FONT_FACES below replaces them).
  (katexCss ? `<style>${katexCss.replaceAll(KATEX_FONT_FACE_REGEX, '')}</style>` : '') +
  // KaTeX fonts as bundled assets: the stylesheet's relative font paths
  // cannot resolve inside a srcdoc iframe, so re-declare every @font-face
  // with the app-served woff2 URLs (overrides the relative ones).
  `<style>${KATEX_FONT_FACES}</style>`;

/** postMessage type used by the in-iframe height/width reporter. */
export const HTML_RENDER_RESIZE_TYPE = 'lobe-html-render-resize';
/** postMessage type used by the host to request a re-measurement. */
export const HTML_RENDER_MEASURE_TYPE = 'lobe-html-render-measure';

/**
 * Height/width reporter injected into the preview document.
 *
 * Why not scrollHeight: the root element's scrollable overflow always covers
 * the viewport, so `documentElement.scrollHeight >= iframe height` once the
 * iframe is taller than its content (details collapsed, viewport resize,
 * cached-startup height) — an auto-height loop driven by scrollHeight can
 * never shrink back down. The body box (BFC via flow-root) is the true
 * content height and shrinks and grows correctly.
 *
 * Every report carries the iframe viewport size so the host can tell whether
 * the width was measured at the final height. Width may depend on viewport
 * height (`vh`/`vmin`, `@media (min-height)`, scripts reading innerHeight),
 * and the first mount after streaming starts at 1px tall — applying that
 * first width would collapse the wrapper before the height is applied.
 */
/**
 * In-memory localStorage/sessionStorage shim. A sandboxed iframe without
 * allow-same-origin throws a SecurityError on any storage access — model
 * scripts that touch localStorage "for convenience" (a common demo habit)
 * would die on the spot. The shim installs per-frame Storage objects that
 * satisfy the interface; state is throwaway (the sandbox is ephemeral).
 */
const buildStorageShimScript = (): string =>
  '<script>' +
  '(function(){' +
  'function createStorage(){var store=Object.create(null);return{' +
  'get length(){return Object.keys(store).length;},' +
  'key:function(i){var k=Object.keys(store);return i>=0&&i<k.length?k[i]:null;},' +
  'getItem:function(k){return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null;},' +
  'setItem:function(k,v){store[String(k)]=String(v);},' +
  'removeItem:function(k){delete store[k];},' +
  'clear:function(){store=Object.create(null);}' +
  '};}' +
  'function tryShim(name){try{void window[name];}catch(e){try{Object.defineProperty(window,name,{configurable:true,get:function(){return createStorage();}});}catch(e2){}}}' +
  'tryShim("localStorage");tryShim("sessionStorage");' +
  '})();' +
  '</script>';

const buildHeightScript = (frameId: string): string =>
  '<script>' +
  '(function(){' +
  'var fid=' +
  JSON.stringify(frameId) +
  ';' +
  'function measureHeight(){var b=document.body;if(!b)return 0;return Math.ceil(b.getBoundingClientRect().bottom);}' +
  // Content width: the rightmost edge of the body's direct children (plus
  // margin). The body box itself always spans the viewport, so it cannot be
  // used — children reflect the fragment's real width, letting the host
  // shrink the preview wrapper to hug narrow content.
  'function measureWidth(){var b=document.body;if(!b)return 0;var max=0;var kids=b.children;' +
  'for(var i=0;i<kids.length;i++){var r=kids[i].getBoundingClientRect();var cs=getComputedStyle(kids[i]);' +
  'var right=r.right+parseFloat(cs.marginRight||"0");if(right>max)max=right;}' +
  'return Math.ceil(max);}' +
  // Visible text snapshot for the host-side copy bridge. innerText preserves
  // rendered line breaks; textContent is the fallback for older engines.
  'function measureText(){var b=document.body;return b?(b.innerText||b.textContent||""):"";}' +
  // The viewport dimensions and visible text are sent with every report: the
  // host applies width only once the viewport already has the reported content
  // height, and keeps the text snapshot ready for host-range copy.
  'function post(){var h=measureHeight();var w=measureWidth();var t=measureText();if(h>0)parent.postMessage({type:' +
  JSON.stringify(HTML_RENDER_RESIZE_TYPE) +
  ',frameId:fid,height:h,width:w,text:t,viewportHeight:window.innerHeight,viewportWidth:window.innerWidth},"*");}' +
  // Interactive fragments can swap visible text without changing the body box
  // (e.g. switching tabs inside a fixed-height card). Debounce DOM mutations
  // into a fresh report so the host copy bridge never falls behind.
  'var textTimer=0;' +
  'function schedulePost(){if(textTimer)return;textTimer=setTimeout(function(){textTimer=0;post();},80);}' +
  // The script lives in <head>, where document.body is not parsed yet —
  // attach the observers after the document is ready, then report once.
  'function attach(){var b=document.body;if(!b)return;try{new ResizeObserver(post).observe(b);}catch(e){}' +
  'try{new MutationObserver(schedulePost).observe(b,{subtree:true,childList:true,characterData:true});}catch(e){}' +
  // Host height changes reflow viewport-relative content, so re-measure when
  // the iframe viewport resizes or the document (and its late resources)
  // finishes loading.
  'window.addEventListener("resize",post);window.addEventListener("load",post);' +
  'window.addEventListener("message",function(event){var d=event.data;if(d&&d.type===' +
  JSON.stringify(HTML_RENDER_MEASURE_TYPE) +
  '&&d.frameId===fid)requestAnimationFrame(post);});' +
  'post();}' +
  'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",attach);}else{attach();}' +
  '})();' +
  '</script>';

/**
 * In-iframe handler for click-outside deselection. The sandboxed iframe is a
 * separate document, so a click on the host page outside the Render block is
 * never visible to the fragment's own document-level listeners. When the
 * iframe loses focus (which happens on any outside click), this handler clears
 * any native text selection, blurs the active element, and replays a
 * pointer/mouse/click sequence on the document root so custom "click outside
 * to close/deselect" scripts inside the fragment run too.
 */
const buildClearSelectionScript = (): string =>
  '<script>' +
  '(function(){' +
  'function clearSelection(){' +
  'try{var s=window.getSelection();if(s&&s.removeAllRanges)s.removeAllRanges();}catch(e){}' +
  'try{if(document.activeElement&&document.activeElement.blur)document.activeElement.blur();}catch(e){}' +
  'try{var root=document.body||document.documentElement;if(root&&root.dispatchEvent){' +
  'var opts={bubbles:true,cancelable:true,view:window};' +
  'if(typeof PointerEvent!=="undefined")root.dispatchEvent(new PointerEvent("pointerdown",opts));' +
  'root.dispatchEvent(new MouseEvent("mousedown",opts));' +
  'root.dispatchEvent(new MouseEvent("click",opts));' +
  '}}catch(e){}' +
  '}' +
  'window.addEventListener("blur",clearSelection);' +
  '})();' +
  '</script>';

/**
 * In-iframe copy handler for KaTeX formulas. The sandboxed HTML-Render
 * iframe is a separate document, so the host page's global copy-tex listener
 * does not apply inside it. This mirrors KaTeX's official contrib/copy-tex
 * behavior: copying a rendered formula copies its original LaTeX source.
 */
const buildKatexCopyScript = (): string => `<script>
(function () {
  function closestKatex(node) {
    var element = node instanceof Element ? node : node.parentElement;
    return element && element.closest('.katex');
  }
  function katexReplaceWithTex(fragment) {
    var katexHtml = fragment.querySelectorAll('.katex-mathml + .katex-html');
    for (var i = 0; i < katexHtml.length; i++) {
      var element = katexHtml[i];
      if (element.remove) element.remove();
      else if (element.parentNode) element.parentNode.removeChild(element);
    }
    var katexMathml = fragment.querySelectorAll('.katex-mathml');
    for (var j = 0; j < katexMathml.length; j++) {
      var element = katexMathml[j];
      var texSource = element.querySelector('annotation');
      if (texSource) {
        if (element.replaceWith) element.replaceWith(texSource);
        else if (element.parentNode) element.parentNode.replaceChild(texSource, element);
        texSource.innerHTML = '$' + texSource.innerHTML + '$';
      }
    }
    var displays = fragment.querySelectorAll('.katex-display annotation');
    for (var k = 0; k < displays.length; k++) {
      var element = displays[k];
      element.innerHTML = '$' + '$' + element.innerHTML.substr(1, element.innerHTML.length - 2) + '$' + '$';
    }
    return fragment;
  }
  document.addEventListener('copy', function (event) {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    var range = selection.getRangeAt(0);
    var startKatex = closestKatex(range.startContainer);
    if (startKatex) range.setStartBefore(startKatex);
    var endKatex = closestKatex(range.endContainer);
    if (endKatex) range.setEndAfter(endKatex);
    var fragment = range.cloneContents();
    if (!fragment.querySelector('.katex-mathml')) return;
    var htmlContents = Array.prototype.map.call(fragment.childNodes, function (el) {
      return el instanceof Text ? el.textContent : el.outerHTML;
    }).join('');
    event.clipboardData.setData('text/html', htmlContents);
    event.clipboardData.setData('text/plain', katexReplaceWithTex(fragment).textContent);
    event.preventDefault();
  });
})();
</script>`;

/**
 * Replace <formula>…</formula> elements with KaTeX typeset output.
 *
 * Math support without external scripts: KaTeX runs in the host bundle at
 * document-build time and emits static HTML+CSS into the sandboxed iframe
 * (its stylesheet is inlined via ?inline). The rendered output is passed
 * through the style whitelist again, so a hostile formula cannot smuggle
 * url()/expression() styles through \htmlStyle.
 */
/**
 * Common human-friendly math glyphs models tend to type instead of LaTeX
 * commands (e.g. "±" instead of "\\pm"). KaTeX rejects them; normalize
 * before rendering when the raw source fails.
 */
const UNICODE_TO_LATEX: Record<string, string> = {
  '±': '\\pm',
  '√': '\\sqrt',
  '×': '\\times',
  '÷': '\\div',
  '∑': '\\sum',
  'π': '\\pi',
  '∞': '\\infty',
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\ne',
  '≈': '\\approx',
  '→': '\\to',
  '←': '\\gets',
  'α': '\\alpha',
  'β': '\\beta',
  'γ': '\\gamma',
  'θ': '\\theta',
  'λ': '\\lambda',
  'μ': '\\mu',
  'σ': '\\sigma',
  'Δ': '\\Delta',
  'Ω': '\\Omega',
  '∫': '\\int',
  '∂': '\\partial',
  '∇': '\\nabla',
  '∈': '\\in',
  '∉': '\\notin',
  '⊂': '\\subset',
  '⊆': '\\subseteq',
  '∪': '\\cup',
  '∩': '\\cap',
  '∅': '\\emptyset',
  '∀': '\\forall',
  '∃': '\\exists',
  '·': '\\cdot',
  '…': '\\ldots',
  '°': '^{\\circ}',
  '²': '^2',
  '³': '^3',
};
const normalizeTexGlyphs = (tex: string): string =>
  tex.replaceAll(/[±√×÷∑π∞≤≥≠≈→←αβγθλμσΔΩ∫∂∇∈∉⊂⊆∪∩∅∀∃·…°²³]/g, (ch) => UNICODE_TO_LATEX[ch] ?? ch);

const renderTex = (tex: string, displayMode: boolean): string => {
  const attempt = (source: string): string => {
    try {
      return katex.renderToString(source, { displayMode, throwOnError: true });
    } catch {
      return '';
    }
  };
  return attempt(tex) || attempt(normalizeTexGlyphs(tex));
};

/**
 * Apply the style whitelist to KaTeX output — a hostile formula could
 * smuggle url()/expression() through \htmlStyle.
 */
const sanitizeRenderedNodes = (nodes: Array<ChildNode>): void => {
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const style = el.getAttribute('style');
    if (style) {
      const kept = sanitizeStyleValue(style);
      if (kept) el.setAttribute('style', kept);
      else el.removeAttribute('style');
    }
    if (el.hasChildNodes()) sanitizeRenderedNodes(Array.from(el.childNodes));
  }
};
/**
/**
 * Math syntax inside fragments: standard $...$ (inline) / $$...$$ (display)
 * like the host markdown, plus the legacy <formula> tag kept for
 * forward compatibility with older model output.
 *
 * The $ parsing is delegated to KaTeX's official auto-render contrib
 * (the same delimiter logic powering the upstream remark-math ecosystem)
 * running at document-build time against the parsed fragment — no runtime
 * scripts inside the sandboxed iframe. KaTeX's stylesheet is inlined via
 * ?inline, so the output is fully static.
 */
const MATH_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
];

export const renderFormulas = (root: Element | Document): void => {
  // Legacy <formula> tags — kept for forward compatibility with older
  // model output.
  root.querySelectorAll('formula').forEach((el) => {
    const tex = el.textContent || '';
    const displayMode = el.getAttribute('display') === 'block';
    const html = renderTex(tex, displayMode);
    if (!html) {
      el.replaceWith(document.createTextNode(tex));
      return;
    }
    const rendered = new DOMParser().parseFromString(html, 'text/html');
    sanitizeRenderedNodes(Array.from(rendered.body.childNodes));
    el.replaceWith(...Array.from(rendered.body.childNodes));
  });

  // Standard $...$ / $$...$$ — official auto-render contrib. It walks the
  // DOM itself (merging adjacent text nodes, honouring \\$ escapes and
  // brace levels, skipping code/pre/script) and swaps math in place.
  const elem = root instanceof Document ? root.body : (root as Element);
  if (!elem) return;
  renderMathInElement(elem, {
    delimiters: MATH_DELIMITERS,
    errorCallback: () => undefined,
    throwOnError: false,
  });
  // A hostile formula could smuggle url()/expression() through
  // \\htmlStyle — sanitize the freshly rendered markup.
  sanitizeRenderedNodes(Array.from(elem.childNodes));
};
/**
 * Theme tokens serialized into the preview document as CSS variables, so
 * model-authored fragments can follow LobeHub's palette and adapt to the
 * user's light/dark theme instead of hard-coding light-theme hex values.
 */
export type FragmentThemeTokens = Record<string, string>;

const buildThemeVariableStyle = (tokens: FragmentThemeTokens | undefined): string => {
  if (!tokens || Object.keys(tokens).length === 0) return '';
  const vars = Object.entries(tokens)
    // strip characters that could break out of the CSS declaration
    .map(([name, value]) => `${name}:${value.replaceAll(/[;{}]/g, '')}`)
    .join(';');
  return `<style>:root{${vars}}</style>`;
};

/**
 * Build the full preview document: sanitized fragment body + our own
 * display-only styles, theme variables and height reporter. No third-party
 * scripts ever run inside (the sandbox allows scripts but the sanitizer
 * strips them all).
 */
export const buildPreviewDocument = (
  frameId: string,
  rawHtml: string,
  themeTokens?: FragmentThemeTokens,
): string => {
  if (typeof DOMParser === 'undefined') {
    return [
      '<!DOCTYPE html><html><head>',
      PREVIEW_STYLE,
      buildThemeVariableStyle(themeTokens),
      buildStorageShimScript(),
      buildHeightScript(frameId),
      buildClearSelectionScript(),
      buildKatexCopyScript(),
      '</head><body>',
      stripDangerousMarkup(rawHtml),
      '</body></html>',
    ].join('');
  }

  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  doc.querySelectorAll(REMOVE_SELECTORS).forEach((el) => el.remove());
  stripExecutableAttributes(doc);
  // <style> elements are allowed (self-contained inside the sandboxed
  // iframe) but their contents go through the same value blacklist. Note
  // DOMParser moves <style> into <head> even for headless fragments — collect
  // them and carry them into the body so they survive.
  doc.querySelectorAll('style').forEach((el) => sanitizeStyleElement(el));
  const fragmentStyles = Array.from(doc.head.querySelectorAll('style'))
    .map((el) => el.outerHTML)
    .join('');
  // <formula> tags typeset via KaTeX after sanitization — the generated
  // markup is ours, not the model's, so it bypasses the tag whitelist.
  renderFormulas(doc);

  return [
    '<!DOCTYPE html><html>',
    '<head>',
    PREVIEW_STYLE,
    buildThemeVariableStyle(themeTokens),
    buildStorageShimScript(),
    buildHeightScript(frameId),
    buildClearSelectionScript(),
    buildKatexCopyScript(),
    '</head>',
    `<body>${fragmentStyles}${doc.body.innerHTML}</body>`,
    '</html>',
  ].join('');
};

export const selectAllInNode = (node: HTMLElement): void => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
};

const handleSelectAllInPre = (event: React.KeyboardEvent<HTMLPreElement>): void => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
    // Select just the code — the default action selects the whole page.
    event.preventDefault();
    selectAllInNode(event.currentTarget);
  }
};

const Render = memo<HtmlRenderProps>(({ children, id, open, streaming }) => {
  const { t } = useTranslation('chat');
  const [showSource, setShowSource] = useState(false);
  const sourceRef = useRef<HTMLPreElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const frameIdRef = useRef('html-render-' + id);
  const { token } = theme.useToken();

  // Last known height drives the initial iframe height on (re)mount — the
  // height reporter corrects it immediately, but starting near the final
  // value avoids a 1px flash for virtual-list remounts.
  const heightRef = useRef(iframeHeightCache.get(id) ?? 1);
  // Last known hug width, restored on preview (re)mount exactly like height.
  const widthRef = useRef<number | null>(iframeWidthCache.get(id) ?? null);
  // Latest visible text reported by the iframe, used by the host-side copy
  // bridge when the host selection includes this iframe.
  const textRef = useRef('');

  const rawHtml = useMemo(() => ((children as string) || '').trim(), [children]);

  // Serialize the current LobeHub theme into the preview document so model
  // fragments can reference --lobe-* variables (and follow dark mode).
  const themeTokens = useMemo<FragmentThemeTokens>(
    () => ({
      '--lobe-color-primary': token.colorPrimary,
      '--lobe-color-text': token.colorText,
      '--lobe-color-text-secondary': token.colorTextSecondary,
      '--lobe-color-text-tertiary': token.colorTextTertiary,
      '--lobe-color-bg-container': token.colorBgContainer,
      '--lobe-color-border': token.colorBorder,
      '--lobe-color-border-secondary': token.colorBorderSecondary,
      '--lobe-color-success': token.colorSuccess,
      '--lobe-color-warning': token.colorWarning,
      '--lobe-color-error': token.colorError,
      '--lobe-color-info': token.colorInfo,
      '--lobe-radius': `${token.borderRadius}px`,
      '--lobe-radius-lg': `${token.borderRadiusLG}px`,
      // Host typography so the preview matches the surrounding chat: the
      // sandboxed iframe cannot see the host stylesheet, so without these the
      // fragment falls back to the browser default font stack and size.
      '--lobe-font-family': token.fontFamily,
      '--lobe-font-size': `${token.fontSize}px`,
      '--lobe-line-height': `${token.lineHeight}`,
    }),
    [
      token.colorBgContainer,
      token.colorBorder,
      token.colorBorderSecondary,
      token.colorError,
      token.colorInfo,
      token.colorPrimary,
      token.colorSuccess,
      token.colorText,
      token.colorTextSecondary,
      token.colorTextTertiary,
      token.colorWarning,
      token.borderRadius,
      token.borderRadiusLG,
      token.fontFamily,
      token.fontSize,
      token.lineHeight,
    ],
  );

  // Build the iframe document lazily: while the fragment is still streaming
  // (or the user is viewing source) the iframe is not rendered, so running the
  // DOMParser / KaTeX sanitization pass on every chunk would only block the
  // main thread and make streaming feel janky.
  const isStreaming = Boolean(streaming && open);
  const docHtml = useMemo(() => {
    if (isStreaming || showSource) return '';
    return buildPreviewDocument(frameIdRef.current, rawHtml, themeTokens);
  }, [isStreaming, rawHtml, showSource, themeTokens]);

  // Restore the last known hug width when the preview (re)mounts. Written
  // imperatively like the reporter updates so React never owns this style.
  useLayoutEffect(() => {
    if (isStreaming || showSource || !widthRef.current || !previewWrapRef.current) return;
    previewWrapRef.current.style.width = `${widthRef.current}px`;
  }, [isStreaming, showSource]);

  // While the preview is mounted, register the iframe's live text snapshot as
  // a copy source. The document-level copy handler replaces the selected
  // <iframe> node with this text before the browser serializes the selection.
  useEffect(() => {
    if (isStreaming || showSource) return;
    return registerHtmlRenderCopySource(frameIdRef.current, () => textRef.current);
  }, [isStreaming, showSource]);

  // In-place height updates: write the iframe style directly (no React state,
  // no re-render) so virtua's item resize observation stays the only layout
  // cost. The reporter inside the iframe can both grow and shrink the box.
  useEffect(() => {
    let measureFrame = 0;

    const requestMeasure = (): void => {
      if (measureFrame || !iframeRef.current?.contentWindow) return;
      measureFrame = window.requestAnimationFrame(() => {
        measureFrame = 0;
        iframeRef.current?.contentWindow?.postMessage(
          { frameId: frameIdRef.current, type: HTML_RENDER_MEASURE_TYPE },
          '*',
        );
      });
    };

    const applyWidth = (width: number): void => {
      widthRef.current = width;
      iframeWidthCache.set(id, width);
      if (previewWrapRef.current) {
        previewWrapRef.current.style.width = `${Math.max(width, 16)}px`;
      }
    };

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.type !== HTML_RENDER_RESIZE_TYPE) return;
      if (data.frameId !== frameIdRef.current) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const height = Number(data.height);
      if (!Number.isFinite(height) || height <= 0) return;
      heightRef.current = height;
      if (iframeRef.current) iframeRef.current.style.height = `${height}px`;
      iframeHeightCache.set(id, height);
      if (typeof data.text === 'string') textRef.current = data.text;

      // Hug narrow fragments: shrink the preview wrapper to the content
      // width so the floating action sits at the content's right edge, not
      // the message column's.
      const width = Number(data.width);
      if (!previewWrapRef.current || !Number.isFinite(width) || width <= 0) return;

      // The reporter sends the iframe viewport size it measured in. Width can
      // depend on viewport height (vh/vmin, @media (min-height), scripts that
      // read innerHeight), so a report from the 1px first mount must not be
      // applied: the wrapper would collapse to min-width before the height is
      // set and the next report would be measured inside that collapsed
      // viewport (e.g. min(100%, 100vh) stays stuck at 16px). Apply the
      // height first and ask the iframe to re-measure at its final size.
      const viewportHeight = Number(data.viewportHeight);
      if (Number.isFinite(viewportHeight) && Math.abs(viewportHeight - height) > 1) {
        requestMeasure();
        return;
      }

      applyWidth(width);
    };
    window.addEventListener('message', handler);
    return () => {
      if (measureFrame) window.cancelAnimationFrame(measureFrame);
      window.removeEventListener('message', handler);
    };
  }, [id]);

  // Entering source mode focuses the pre so Ctrl/Cmd+A selects only the code.
  useEffect(() => {
    if (showSource) sourceRef.current?.focus();
  }, [showSource]);

  return (
    <div className={styles.container}>
      {showSource ? (
        <>
          <pre
            className={styles.source}
            ref={sourceRef}
            tabIndex={0}
            onKeyDown={handleSelectAllInPre}
          >
            {rawHtml}
          </pre>
          <div className={cx(styles.floatingAction, 'html-render-floating-action')}>
            <button
              aria-label={t('htmlRender.render')}
              className={styles.button}
              title={t('htmlRender.render')}
              type="button"
              onClick={() => setShowSource(false)}
            >
              <Eye size={13} />
            </button>
          </div>
        </>
      ) : isStreaming ? (
        // While the fragment is still streaming, show the raw source as plain
        // DOM: the content stays visible, the row height follows the text
        // synchronously (no iframe, no cross-document round-trip), and the
        // list scrolls undisturbed. The rendered iframe preview swaps in once
        // the fragment closes.
        <pre className={styles.source} tabIndex={0} onKeyDown={handleSelectAllInPre}>
          {rawHtml}
        </pre>
      ) : (
        <>
          {/* Sandboxed iframe: scripts/forms/modals allowed (like the artifact
            HTML preview), no allow-same-origin: fragment
              content originates from model output and must never read host
              cookies/storage even if sanitization is ever bypassed. */}
          <div className={styles.previewWrap} ref={previewWrapRef}>
            <iframe
              data-html-render-copy-id={frameIdRef.current}
              name={frameIdRef.current}
              ref={iframeRef}
              sandbox="allow-scripts allow-forms allow-modals"
              srcDoc={docHtml}
              style={{ display: 'block', width: '100%', border: 'none', height: heightRef.current }}
              title={t('htmlRender.title')}
            />
            <div className={cx(styles.floatingAction, 'html-render-floating-action')}>
              <button
                aria-label={t('htmlRender.source')}
                className={styles.button}
                title={t('htmlRender.source')}
                type="button"
                onClick={() => setShowSource(true)}
              >
                <Code2 size={13} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

Render.displayName = 'HtmlRender';

export default Render;
