import { type MarkdownProps } from '@lobehub/ui';
import { Markdown } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';

import { rehypeRawText } from '@/features/Conversation/Markdown/plugins/rehypePlugins/rehypeRawText';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const MarkdownMessage = memo<MarkdownProps>(
  ({ children, componentProps, rehypePlugins, ...rest }) => {
    const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
      userGeneralSettingsSelectors.config,
    );

    // Preserve line breaks when raw HTML falls back to literal text. Keep the
    // plugin last so element-specific rehype plugins see their raw tags first.
    const rehypePluginsWithRawText = useMemo(
      () => [...(rehypePlugins ?? []), rehypeRawText],
      [rehypePlugins],
    );

    useEffect(() => {
      // Enable KaTeX official copy-tex extension:
      // copying rendered math should copy the original LaTeX source instead of visual text.
      void import('katex/dist/contrib/copy-tex.mjs');
    }, []);

    return (
      <Markdown
        fontSize={fontSize}
        rehypePlugins={rehypePluginsWithRawText}
        variant={'chat'}
        componentProps={{
          ...componentProps,
          highlight: {
            fullFeatured: true,
            theme: highlighterTheme,
            ...componentProps?.highlight,
          },
          mermaid: { fullFeatured: false, theme: mermaidTheme, ...componentProps?.mermaid },
        }}
        {...rest}
      >
        {children}
      </Markdown>
    );
  },
);

export default MarkdownMessage;
