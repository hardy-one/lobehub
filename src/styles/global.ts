import type { LobeTheme } from '@lobehub/ui';
import { CLASSNAMES, css } from '@lobehub/ui';

import { CONVERSATION_PRINT_ROOT_CLASS } from '@/features/Conversation/ChatList/constants';
import {
  MAC_PANEL_BG_VAR,
  MAC_WINDOW_FULLSCREEN_SELECTOR,
} from '@/features/Electron/system/macWindowFullscreen';

// fix ios input keyboard
// overflow: hidden;
// ref: https://zhuanlan.zhihu.com/p/113855026
const genGlobalStyle = ({ token }: { prefixCls: string; token: LobeTheme }) => css`
  html {
    text-size-adjust: 100%;
  }

  html,
  body,
  #__next {
    position: relative;

    overscroll-behavior: none;

    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;

    @media (device-width >= 576px) {
      overflow: hidden;

      /* The root cannot scroll here, and a root 'none' also suppresses the
         elastic overscroll of inner scrollers in Chromium on macOS. */
      overscroll-behavior: auto;
    }
  }

  body {
    /* Own stacking context, otherwise render black edges will appear. Must NOT
       be a transform-based hack: a transform on body rebases every position:
       fixed descendant onto body, and a drawer panel mid slide-in then overflows
       body horizontally — focusing it scrolls the whole page sideways. */
    will-change: opacity;
    isolation: isolate;
  }

  * {
    scrollbar-color: ${token.colorFill} transparent;
    scrollbar-width: thin;

    ::-webkit-scrollbar {
      width: 0.75em;
      height: 0.75em;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 10px;
    }

    :hover::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      background-color: ${token.colorText};
      background-clip: content-box;
    }

    ::-webkit-scrollbar-track {
      background-color: transparent;
    }
  }

  /* antd resets re-apply antialiased on each component root, so body alone is not enough */
  html[data-font-antialiasing='off'] * {
    -webkit-font-smoothing: auto;
    -moz-osx-font-smoothing: auto;
  }

  html.desktop[data-theme='dark'] body {
    background-color: color-mix(in srgb, ${token.colorBgLayout} 50%, transparent);
  }

  html.desktop[data-theme='light'] body {
    background-color: color-mix(in srgb, ${token.colorBgLayout} 70%, transparent);
  }

  ${MAC_WINDOW_FULLSCREEN_SELECTOR} {
    ${MAC_PANEL_BG_VAR}: ${token.colorBgLayout};
  }

  ${MAC_WINDOW_FULLSCREEN_SELECTOR} body {
    background-color: ${token.colorBgLayout};
  }

  button {
    -webkit-app-region: no-drag;
  }

  .${CLASSNAMES.ContextTrigger}[data-popup-open]:not([data-no-highlight]),
  .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight]) {
    background: ${token.colorFillTertiary};
  }
  .accordion-action:has(
    .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight])
  ) {
    opacity: 1;
  }

  /* Printing a conversation: keep only its transcript, no sidebars, headers,
     composer or docks, and let the document grow past one viewport. */
  @media screen {
    .${CONVERSATION_PRINT_ROOT_CLASS} {
      display: none;
    }
  }

  @media print {
    html:has(> body > .${CONVERSATION_PRINT_ROOT_CLASS}),
    body:has(> .${CONVERSATION_PRINT_ROOT_CLASS}) {
      overflow: visible;

      height: auto;
      min-height: 0;
      max-height: none;

      /* Paper is white. next-themes writes a dark color-scheme inline on html,
         which paints the page canvas dark, and the dark theme paints body. */
      color-scheme: light !important;
      background: none !important;
    }

    body:has(> .${CONVERSATION_PRINT_ROOT_CLASS}) > :not(.${CONVERSATION_PRINT_ROOT_CLASS}) {
      display: none !important;
    }
  }

  /* @lobehub/ui Button always renders its spinner ring and only collapses the
     slot to opacity: 0 / width: 0 when not loading (Button.mjs:75), so every
     button on the page keeps a 0.6s infinite rotation ticking — invisible, but
     still driving style recalc and layerization. The slot carries
     aria-hidden={!loading}, so stopping the ring inside a collapsed slot leaves
     every genuinely loading button spinning. */
  button > span[aria-hidden='true'] > span {
    animation: none !important;
  }

  /* @lobehub/ui hides the text sweep on a shiny host that has children
     (.lobe-text-shiny:not(:has(*))), because its ::after overlay would sit
     behind opaque descendants. A row-level sweep needs the animation on the
     host itself, so opt in explicitly and keep the overlay above the row. */
  .lobe-text-shiny-leaf:not(:has(*)) {
    position: relative;
  }

  .lobe-text-shiny-leaf:not(:has(*))::after {
    z-index: 1;
  }
`;

export default genGlobalStyle;
