import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Render, {
  buildPreviewDocument,
  HTML_RENDER_MEASURE_TYPE,
  HTML_RENDER_RESIZE_TYPE,
  iframeHeightCache,
  iframeWidthCache,
  sanitizeStyleValue,
  selectAllInNode,
  stripDangerousMarkup,
} from './index';

// KaTeX disables its DOM render API (used by auto-render) at module load
// when document.compatMode is not CSS1Compat. The happy-dom test document has
// no doctype and reports undefined — normalize it before katex is imported so
// the $...$ math path is exercised for real.
vi.hoisted(() => {
  Object.defineProperty(document, 'compatMode', { configurable: true, value: 'CSS1Compat' });
});

vi.mock('katex/dist/katex.min.css?inline', () => ({
  // includes the stylesheet's own relative-path @font-face (as in the real
  // katex.min.css) so the strip test below exercises the real shape
  default:
    '.katex{font-size:1em}@font-face{font-family:KaTeX_Test;src:url(fonts/KaTeX_Test.woff2) format("woff2")}',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const makeProps = (children: string, open = false) => ({
  children,
  id: 'msg-test-1',
  node: { properties: {} },
  open,
  tagName: 'html-render',
  type: 'element',
});

describe('buildPreviewDocument', () => {
  it('should wrap the fragment into a full document', () => {
    const doc = buildPreviewDocument('f1', '<div style="color:red">卡片</div>');

    expect(doc).toContain('<!DOCTYPE html><html>');
    expect(doc).toContain('<div style="color:red">卡片</div>');
    expect(doc).toContain('</html>');
  });

  it('should keep scripts, iframes and forms (sandboxed artifact-style preview)', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div>ok</div><script>window.__x = 1</script><iframe src="https://evil"></iframe><form><input></form>',
    );

    // scripts/forms/embeds run inside the sandboxed iframe — they are kept,
    // only the legacy plugin tags (object/embed) are removed
    expect(doc).toContain('<script>window.__x = 1</script>');
    expect(doc).toContain('<iframe');
    expect(doc).toContain('<form');
    expect(doc).toContain('<input>');
    expect(doc).toContain('<div>ok</div>');
  });

  it('should remove legacy plugin containers (object/embed)', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div>ok</div><object data="x"></object><embed src="y">',
    );

    expect(doc).not.toContain('<object');
    expect(doc).not.toContain('<embed');
    expect(doc).toContain('<div>ok</div>');
  });

  it('should keep event handlers (scripts allowed) but strip javascript: URLs', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div>ok</div><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">bad</a><svg onload="alert(3)"></svg>',
    );

    // event handlers are legal now — scripts run inside the sandbox
    expect(doc).toContain('onerror="alert(1)"');
    expect(doc).toContain('onload="alert(3)"');
    // javascript: URLs stay stripped (accidental-execution footgun)
    expect(doc).not.toContain('javascript:');
    expect(doc).toContain('<div>ok</div>');
    expect(doc).toContain('<a>bad</a>');
  });

  it('should keep remote media and form controls (external resources allowed)', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div>ok</div><img src="https://evil/tracker.png"><video src="https://evil/v.mp4"></video><button>点我</button><input type="text">',
    );

    expect(doc).toContain('<img src="https://evil/tracker.png">');
    expect(doc).toContain('<video src="https://evil/v.mp4">');
    expect(doc).toContain('<button>点我</button>');
    expect(doc).toContain('<input type="text">');
    expect(doc).toContain('<div>ok</div>');
  });

  it('should keep url() style values (external allowed) while dropping legacy CSS', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div style="background:url(javascript:alert(1))">x</div><p style="color:red">ok</p><span style="behavior:url(x)">y</span>',
    );

    expect(doc).toContain('url(javascript:');
    expect(doc).toContain('<p style="color:red">ok</p>');
    // legacy executable CSS is still dropped
    expect(doc).not.toContain('behavior:url(x)');
  });

  it('should strip javascript: URLs obfuscated with tab/newline characters', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div>ok</div><a href="java&#x9;script:alert(1)">bad</a><a href="java&#10;script:alert(2)">worse</a>',
    );

    expect(doc).not.toContain('script:alert');
    expect(doc).toContain('<div>ok</div>');
  });

  it('should keep safe <style> blocks and drop resource-smuggling ones', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<style>.card{color:#333}:hover{opacity:.8}@keyframes f{from{opacity:0}}</style><div class="card">x</div>',
    );

    // safe in-fragment stylesheet survives
    expect(doc).toContain('@keyframes f');
    expect(doc).toContain('.card{color:#333}');
    // class attributes are not stripped either
    expect(doc).toContain('class="card"');
  });

  it('should keep <style> blocks with external resources (network loads allowed)', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<style>@import url(https://evil/x.css);.a{color:red}</style><div>x</div>',
    );

    expect(doc).toContain('@import url(https://evil/x.css)');
    expect(doc).toContain('.a{color:red}');
  });

  it('should keep style tags, CSS url() and SVG remote references (external allowed)', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div>ok</div><style>@import url(https://evil/track.css)</style><div style="background:url(https://evil/track.png)">x</div><svg><image href="https://evil/x.png"></image><use href="https://evil/y.svg"></use></svg>',
    );

    const body = doc.slice(doc.indexOf('<body>'));
    expect(body).toContain('@import url(https://evil/track.css)');
    expect(body).toContain('url(https://evil/track.png)');
    expect(body).toContain('href="https://evil/x.png"');
    expect(body).toContain('href="https://evil/y.svg"');
    expect(body).toContain('<div>ok</div>');
  });

  it('should keep SVG local symbol references and external use references', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<svg><defs><path id="p" d="M0 0"></path></defs><use href="#p"></use><use href="https://evil/y.svg"></use></svg>',
    );

    const body = doc.slice(doc.indexOf('<body>'));
    expect(body).toContain('href="#p"');
    expect(body).toContain('href="https://evil/y.svg"');
  });

  it('should inject the display-only styles into the preview head', () => {
    const doc = buildPreviewDocument('f1', '<div style="height:4000px">超高内容</div>');
    const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'));

    // root never scrolls: overflowing content is clipped, no scrollbar can appear
    expect(head).toContain('html,body{overflow:hidden}');
    // body is a BFC so the height reporter measures margins too
    expect(head).toContain('body{display:flow-root');
    // fragment-internal scroll containers must not render scrollbars either
    expect(head).toContain('*{scrollbar-width:none}');
    expect(head).toContain('*::-webkit-scrollbar{display:none}');
  });

  it('should inject the height reporter with the frame id', () => {
    const doc = buildPreviewDocument('frame-42', '<div>x</div>');

    expect(doc).toContain('frame-42');
    expect(doc).toContain('lobe-html-render-resize');
    // the reporter measures the body box, not the viewport-polluted scrollHeight
    expect(doc).toContain('getBoundingClientRect');
    // every report carries the iframe viewport size, so the host can defer
    // width until the viewport already has the reported content height
    expect(doc).toContain('viewportHeight:window.innerHeight');
    expect(doc).toContain('viewportWidth:window.innerWidth');
    // a host-initiated measure request re-posts after the height was applied
    expect(doc).toContain('lobe-html-render-measure');
    // iframe viewport changes re-measure viewport-relative CSS (vh/vmin)
    expect(doc).toContain('window.addEventListener("resize",post)');
    // every report also carries a visible-text snapshot for host-range copy
    expect(doc).toContain('function measureText');
    expect(doc).toContain('text:t');
    // interactive DOM changes refresh the text snapshot even when the body
    // size stays the same (e.g. switching tabs in a fixed-height card)
    expect(doc).toContain('new MutationObserver(schedulePost)');
    expect(doc).toContain('characterData:true');
  });

  it('should inject the clear-selection handler on iframe blur', () => {
    const doc = buildPreviewDocument('frame-42', '<div>x</div>');

    expect(doc).toContain('window.addEventListener("blur",clearSelection)');
    expect(doc).toContain('removeAllRanges');
    expect(doc).toContain('dispatchEvent');
  });

  it("should strip the KaTeX stylesheet's relative @font-face paths (404 in srcdoc) and keep the rest", () => {
    const doc = buildPreviewDocument('f1', '<div>x</div>');

    // the stylesheet's own relative font URLs cannot resolve inside a srcdoc
    // iframe and would 404 against the host origin — they are removed
    expect(doc).not.toContain('url(fonts/KaTeX_Test.woff2)');
    // the non-font rules (e.g. .katex metrics) survive
    expect(doc).toContain('.katex{font-size:1em}');
  });

  it('should report the content width so the wrapper can hug narrow fragments', () => {
    const doc = buildPreviewDocument('frame-42', '<div>x</div>');

    // the reporter measures the rightmost child edge (plus margin), not the
    // full-viewport body box
    expect(doc).toContain('measureWidth');
    expect(doc).toContain('marginRight');
    expect(doc).toContain('width:w');
  });

  it('should inject theme CSS variables when tokens are provided', () => {
    const doc = buildPreviewDocument('f1', '<div>x</div>', {
      '--lobe-color-primary': '#222222',
      '--lobe-color-text': '#080808',
      '--lobe-radius': '8px',
    });

    const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'));
    expect(head).toContain(
      ':root{--lobe-color-primary:#222222;--lobe-color-text:#080808;--lobe-radius:8px}',
    );
  });

  it('should not inject a variable style without tokens', () => {
    const doc = buildPreviewDocument('f1', '<div>x</div>');

    expect(doc).not.toContain(':root{--lobe');
  });

  it('should apply the host typography (font stack, size, line-height) to the preview body', () => {
    const doc = buildPreviewDocument('f1', '<div>x</div>', {
      '--lobe-font-family': 'Inter, sans-serif',
      '--lobe-font-size': '15px',
      '--lobe-line-height': '1.5',
    });

    // body inherits the host font stack via the theme variables, with a
    // sensible fallback for the no-token SSR path
    expect(doc).toContain('font-family:var(--lobe-font-family');
    expect(doc).toContain('--lobe-font-family:Inter, sans-serif');
    expect(doc).toContain('font-size:var(--lobe-font-size,14px)');
    expect(doc).toContain('line-height:var(--lobe-line-height,1.6)');
    expect(doc).toContain('-webkit-font-smoothing:antialiased');
  });

  it('should strip characters that could break out of the CSS declaration', () => {
    const doc = buildPreviewDocument('f1', '<div>x</div>', {
      '--lobe-color-text': 'red;background:url(evil)}x',
    });

    // ; and } are removed — the value cannot close the :root block or add
    // extra declarations (the check is scoped to the injected value, since
    // PREVIEW_STYLE legitimately contains ';background')
    expect(doc).not.toContain('--lobe-color-text:red;background');
    expect(doc).not.toContain('}x');
  });

  it('should typeset <formula> elements with KaTeX', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<p>公式 <formula>\\frac{a}{b}</formula> 结束</p><formula display="block">x^2</formula>',
    );

    // formula tags are replaced by katex markup
    expect(doc).not.toContain('<formula');
    expect(doc).toContain('katex');
    expect(doc).toContain('frac');
    // katex stylesheet is inlined
    expect(doc).toContain('.katex');
  });

  it('should keep invalid formula source as plain text', () => {
    const doc = buildPreviewDocument('f1', '<formula>\\notaclosing</formula>');

    // throwOnError: false — KaTeX renders a red error span instead of throwing
    expect(doc).not.toContain('<formula');
  });
  it('should typeset standard $...$ inline math in fragments', () => {
    const doc = buildPreviewDocument('f1', '<p>公式 $x^2 + y^2$ 结束</p>');

    expect(doc).toContain('class="katex"');
    expect(doc).not.toContain('$x^2 + y^2$');
  });

  it('should typeset $$...$$ display math and keep legacy <formula> tags', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<p>块级：</p><p>$$\\frac{a}{b}$$</p><formula display="block">\\int_0^1 x\\, dx</formula>',
    );

    // both syntaxes render KaTeX markup
    expect(doc).toContain('katex-display');
    expect(doc).not.toContain('<formula');
    expect(doc).not.toContain('$$');
  });

  it('should not typeset unpaired currency or code blocks as math', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<p>价格 $5 不渲染</p><code>$not math$</code><pre>$also literal$</pre>',
    );

    // an unpaired $ stays literal (paired $s ARE math — same as remark-math)
    expect(doc).toContain('价格 $5');
    // code/pre contents are skipped by auto-render's default ignoredTags
    expect(doc).toContain('$not math$');
    expect(doc).toContain('$also literal$');
  });

  it('should inject the storage shim so sandboxed scripts can touch localStorage', () => {
    const doc = buildPreviewDocument('f1', '<div>x</div>');

    // without allow-same-origin any localStorage access throws; the shim
    // installs an in-memory Storage so model demo scripts do not die
    expect(doc).toContain('tryShim("localStorage")');
    expect(doc).toContain('tryShim("sessionStorage")');
    expect(doc).toContain('createStorage');
  });

  it('should apply the same head in the SSR fallback', () => {
    const doc = buildPreviewDocument('f1', '<div>x</div><script>alert(1)</script>');
    const head = doc.slice(doc.indexOf('<head>'), doc.indexOf('</head>'));

    expect(head).toContain('html,body{overflow:hidden}');
    expect(head).toContain('lobe-html-render-resize');
    expect(head).toContain('window.addEventListener("blur",clearSelection)');
    // scripts are allowed in the sandboxed preview now
    expect(doc).toContain('<script>alert(1)</script>');
  });
});

describe('sanitizeStyleValue (value blacklist)', () => {
  it('should keep any CSS property, dropping only dangerous values', () => {
    const kept = sanitizeStyleValue(
      'color:#080808;font-size:14px;position:absolute;cursor:pointer;float:left;zoom:2',
    );

    // arbitrary properties are unrestricted
    expect(kept).toContain('color:#080808');
    expect(kept).toContain('position:absolute');
    expect(kept).toContain('cursor:pointer');
    expect(kept).toContain('float:left');
    expect(kept).toContain('zoom:2');
    // behavior:url(x) carries url() — its declaration is dropped
    expect(kept).not.toContain('behavior');
  });

  it('should keep local SVG url(#id) references', () => {
    const kept = sanitizeStyleValue('fill:url(#grad);background:url(#paint)');

    expect(kept).toContain('url(#grad)');
    expect(kept).toContain('url(#paint)');
  });

  it('should keep url()/@import declarations (external allowed), dropping legacy executable CSS', () => {
    // external url() and @import are allowed now — the fragment may load
    // remote resources like the artifact preview
    expect(sanitizeStyleValue('background:url(https://evil/x.png)')).toBe(
      'background:url(https://evil/x.png)',
    );
    expect(sanitizeStyleValue('background:url(https://evil/x.png);color:red')).toBe(
      'background:url(https://evil/x.png);color:red',
    );
    // @import has no colon so the declaration is dropped as malformed;
    // siblings survive (harmless: @import is inert inside a style attribute)
    expect(sanitizeStyleValue('@import url(x.css);color:red')).toBe('color:red');
    // legacy executable CSS (behavior:) is still dropped
    expect(sanitizeStyleValue('color:red;behavior:url(x)')).toBe('color:red');
  });

  it('should drop !important declarations', () => {
    const kept = sanitizeStyleValue('color:red !important;font-size:14px');

    expect(kept).not.toContain('!important');
    expect(kept).toContain('font-size:14px');
  });

  it('should keep float (drop caps) and text-wrap declarations', () => {
    const kept = sanitizeStyleValue(
      'float:left;font-size:52px;line-height:0.8;margin-right:8px;overflow-wrap:anywhere',
    );

    expect(kept).toContain('float:left');
    expect(kept).toContain('overflow-wrap:anywhere');
    expect(kept).toContain('margin-right:8px');
  });

  it('should keep gradient text declarations', () => {
    const kept = sanitizeStyleValue(
      'background:linear-gradient(90deg,#f00,#00f);-webkit-background-clip:text;color:transparent',
    );

    expect(kept).toContain('background:linear-gradient');
    expect(kept).toContain('-webkit-background-clip:text');
    expect(kept).toContain('color:transparent');
  });

  it('should apply the whitelist through buildPreviewDocument', () => {
    const doc = buildPreviewDocument(
      'f1',
      '<div style="color:#080808;behavior:url(x);font-size:14px">x</div>',
    );

    expect(doc).toContain('color:#080808');
    expect(doc).toContain('font-size:14px');
    expect(doc).not.toContain('behavior');
  });
});

describe('stripDangerousMarkup (SSR fallback)', () => {
  it('should strip dangerous elements and executable attributes', () => {
    const cleaned = stripDangerousMarkup(
      '<div>ok</div><script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">bad</a>',
    );

    expect(cleaned).toContain('<script>alert(1)</script>');
    expect(cleaned).toContain('<img src="x" onerror="alert(1)">');
    expect(cleaned).toContain('onerror');
    expect(cleaned).not.toContain('javascript:');
    expect(cleaned).not.toContain('javascript:');
    expect(cleaned).toContain('<div>ok</div>');
    expect(cleaned).toContain('<a>bad</a>');
  });

  it('should strip javascript: URLs with leading whitespace or without quotes', () => {
    const cleaned = stripDangerousMarkup(
      '<a href="  javascript:alert(1)">a</a><a href=javascript:alert(2)>b</a>',
    );

    expect(cleaned).not.toContain('javascript:');
    expect(cleaned).toContain('<a>a</a>');
    expect(cleaned).toContain('<a>b</a>');
  });

  it('should strip style attributes referencing javascript: or expression', () => {
    const cleaned = stripDangerousMarkup(
      '<div style="background:url(javascript:alert(1))">x</div><p style="color:red">ok</p><span style="x:expression(alert(1))">y</span>',
    );

    // external url() is allowed now; only legacy executable CSS is stripped
    expect(cleaned).toContain('url(javascript:');
    expect(cleaned).not.toContain('expression(');
    expect(cleaned).toContain('<p style="color:red">ok</p>');
  });
});

describe('HtmlRender Render', () => {
  afterEach(() => {
    iframeHeightCache.clear();
    iframeWidthCache.clear();
  });

  it('should render the fragment in a sandboxed display-only iframe', () => {
    render(<Render {...(makeProps('<div>卡片</div>') as any)} />);

    const iframe = screen.getByTitle('htmlRender.title') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    // host-side copy bridge matches the selected iframe back to its text source
    expect(iframe.getAttribute('data-html-render-copy-id')).toBe('html-render-msg-test-1');
    // isolated from the host: no allow-same-origin, no host access
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-modals');
    expect(iframe.srcdoc).toContain('<div>卡片</div>');
    // display-only: starts at 1px until the in-iframe reporter reports back
    expect(iframe.style.height).toBe('1px');
    expect(screen.getByLabelText('htmlRender.source')).toBeInTheDocument();
  });

  it('should start from the cached height instead of 1px on remount', () => {
    iframeHeightCache.set('msg-test-1', 222);
    render(<Render {...(makeProps('<div>卡片</div>') as any)} />);

    expect((screen.getByTitle('htmlRender.title') as HTMLIFrameElement).style.height).toBe('222px');
  });

  it('should start from the cached width on remount', () => {
    iframeWidthCache.set('msg-test-1', 320);
    render(<Render {...(makeProps('<div>卡片</div>') as any)} />);

    const iframe = screen.getByTitle('htmlRender.title') as HTMLIFrameElement;
    expect((iframe.parentElement as HTMLDivElement).style.width).toBe('320px');
  });

  it('should defer width until the iframe viewport reaches the reported height', () => {
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(((
      callback: FrameRequestCallback,
    ) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame);

    try {
      render(<Render {...(makeProps('<div>卡片</div>') as any)} />);

      const iframe = screen.getByTitle('htmlRender.title') as HTMLIFrameElement;
      const wrap = iframe.parentElement as HTMLDivElement;
      const contentWindow = { postMessage: vi.fn() } as unknown as Window;
      Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: contentWindow });

      const report = (height: number, viewportHeight: number, width: number): void => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              frameId: 'html-render-msg-test-1',
              height,
              type: HTML_RENDER_RESIZE_TYPE,
              viewportHeight,
              viewportWidth: 800,
              width,
            },
            source: contentWindow,
          }),
        );
      };

      // First report is measured while the iframe is still 1px tall. Height is
      // applied immediately, but the width is not trusted and a re-measure is
      // requested instead of collapsing the wrapper first.
      report(120, 1, 1);

      expect(iframe.style.height).toBe('120px');
      expect(wrap.style.width).toBe('');
      expect(contentWindow.postMessage).toHaveBeenCalledWith(
        { frameId: 'html-render-msg-test-1', type: HTML_RENDER_MEASURE_TYPE },
        '*',
      );

      // The re-measure happens after the height was applied: viewportHeight now
      // matches content height, so this width is stable and can be applied.
      report(120, 120, 120);

      expect(wrap.style.width).toBe('120px');
      expect(iframeWidthCache.get('msg-test-1')).toBe(120);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  it('should copy the rendered text when the host selection includes the preview iframe', () => {
    render(<Render {...(makeProps('<div>卡片内容</div>') as any)} />);

    const iframe = screen.getByTitle('htmlRender.title') as HTMLIFrameElement;
    const contentWindow = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(iframe, 'contentWindow', { configurable: true, value: contentWindow });

    // The iframe reporter sends its visible-text snapshot alongside dimensions.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          frameId: 'html-render-msg-test-1',
          height: 40,
          text: '卡片内容',
          type: HTML_RENDER_RESIZE_TYPE,
          viewportHeight: 40,
          viewportWidth: 200,
          width: 200,
        },
        source: contentWindow,
      }),
    );

    // Selecting only the iframe in the host document used to copy an empty
    // string (iframe internals are a separate document). The copy bridge must
    // substitute the reported text before the browser serializes the range.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNode(iframe);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const transfer = new DataTransfer();
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copyEvent, 'clipboardData', { value: transfer });
    document.dispatchEvent(copyEvent);

    expect(copyEvent.defaultPrevented).toBe(true);
    expect(transfer.getData('text/plain')).toBe('卡片内容');
  });

  it('should show the raw source (plain DOM) while the fragment is streaming', () => {
    render(<Render {...(makeProps('<div>卡片</div>', true) as any)} streaming />);

    // no iframe during streaming — the list layout stays synchronous
    expect(screen.queryByTitle('htmlRender.title')).toBeNull();
    // the streaming source is visible and selectable
    expect(screen.getByText('<div>卡片</div>')).toBeInTheDocument();
  });

  it('should render the iframe when an open fragment is not actively streaming', () => {
    render(<Render {...(makeProps('<div>卡片</div>', true) as any)} />);

    expect(screen.getByTitle('htmlRender.title')).toBeInTheDocument();
    expect(screen.queryByText('<div>卡片</div>')).toBeNull();
  });

  it('should toggle between source and preview on button click', () => {
    render(<Render {...(makeProps('<div>卡片</div>') as any)} />);

    fireEvent.click(screen.getByLabelText('htmlRender.source'));

    expect(screen.queryByTitle('htmlRender.title')).toBeNull();
    expect(screen.getByText('<div>卡片</div>')).toBeInTheDocument();
    expect(screen.getByLabelText('htmlRender.render')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('htmlRender.render'));

    expect(screen.getByTitle('htmlRender.title')).toBeInTheDocument();
  });
});

describe('selectAllInNode', () => {
  it('should select only the node contents', () => {
    document.body.innerHTML = '<p id="other">别的内容</p><pre id="code">第一行\n第二行</pre>';
    const pre = document.getElementById('code') as HTMLPreElement;

    selectAllInNode(pre);

    const selected = window.getSelection()?.toString();
    expect(selected).toContain('第一行');
    expect(selected).not.toContain('别的内容');
  });
});
