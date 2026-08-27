'use client';

import { type MarkdownProps } from '@lobehub/ui';
import { type ReactNode, useMemo, useState } from 'react';

import { HtmlPreviewDrawer } from '@/components/HtmlPreview';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, userGeneralSettingsSelectors } from '@/store/user/selectors';

import { HTML_RENDER_TAG, type MarkdownElement, markdownElements } from '../Markdown/plugins';

// Honor each plugin's declared `scope`: this hook renders assistant / grouped
// messages, so user-only constructs (skill, tool, action, mention, …) must not
// be parsed here — otherwise a `<skill … />` the model happens to echo back
// would render as an interactive chip. Mirrors the `scope !== 'assistant'`
// filter on the user-message hook.
const assistantMarkdownElements = markdownElements.filter((s) => s.scope !== 'user');

interface UseChatMarkdownOptions {
  citations?: MarkdownProps['citations'];
  enableStream?: boolean;
  id: string;
  isGenerating: boolean;
}

export const useChatMarkdown = ({
  id,
  isGenerating,
  citations,
  enableStream = true,
}: UseChatMarkdownOptions): {
  drawer: ReactNode;
  markdownProps: Partial<MarkdownProps>;
} => {
  const { transitionMode } = useUserStore(userGeneralSettingsSelectors.config);
  const enableHtmlRender = useUserStore(labPreferSelectors.enableHtmlRender);
  const animated = enableStream && transitionMode === 'fadeIn' && isGenerating;
  const streaming = enableStream && isGenerating;

  const [drawerContent, setDrawerContent] = useState<string | null>(null);

  // The embedded-HTML renderer is lab-gated: when disabled its plugin must not
  // parse the markers (and the raw fragment then stays invisible, matching the
  // "feature off" semantics of the author's script).
  const enabledElements = useMemo(
    () =>
      enableHtmlRender
        ? assistantMarkdownElements
        : assistantMarkdownElements.filter((element) => element.tag !== HTML_RENDER_TAG),
    [enableHtmlRender],
  );

  const rehypePlugins = useMemo(
    () => enabledElements.map((element: MarkdownElement) => element.rehypePlugin).filter(Boolean),
    [enabledElements],
  );
  const remarkPlugins = useMemo(
    () => enabledElements.map((element: MarkdownElement) => element.remarkPlugin).filter(Boolean),
    [enabledElements],
  );

  const components = useMemo(
    () =>
      Object.fromEntries(
        enabledElements.map((element: MarkdownElement) => {
          const Component = element.Component;
          // `animated` / `streaming` ride along for plugins that need
          // streaming-mode awareness (e.g. the html-render preview iframe);
          // other plugins simply ignore the extra props.
          return [
            element.tag,
            (props: any) => (
              <Component {...props} animated={animated} id={id} streaming={streaming} />
            ),
          ];
        }),
      ),
    [animated, enabledElements, id, streaming],
  );

  const markdownProps = useMemo(
    () =>
      ({
        animated,
        citations,
        componentProps: {
          html: {
            onExpand: (content: string) => setDrawerContent(content),
          },
        },
        components,
        enableCustomFootnotes: true,
        enableHtmlPreview: true,
        enableStream,
        rehypePlugins,
        remarkPlugins,
        showFootnotes: !citations?.length || citations.every((item) => item.title !== item.url),
      }) satisfies Partial<MarkdownProps>,
    [animated, citations, components, enableStream, rehypePlugins, remarkPlugins],
  );

  const drawer = useMemo(
    () =>
      drawerContent ? (
        <HtmlPreviewDrawer
          content={drawerContent}
          open={!!drawerContent}
          onClose={() => setDrawerContent(null)}
        />
      ) : null,
    [drawerContent],
  );

  return useMemo(() => ({ drawer, markdownProps }), [drawer, markdownProps]);
};
