import { type FC } from 'react';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import { HTML_RENDER_TAG, remarkHtmlRender } from './remarkHtmlRender';
import Component, { iframeHeightCache, iframeWidthCache } from './Render';

export { HTML_RENDER_TAG } from './remarkHtmlRender';
// Exported for tests: last-known iframe dimensions per message id.
export { iframeHeightCache, iframeWidthCache };

const HtmlRenderElement: MarkdownElement = {
  Component: Component as unknown as FC<MarkdownElementProps>,
  remarkPlugin: remarkHtmlRender,
  scope: 'assistant',
  tag: HTML_RENDER_TAG,
};

export default HtmlRenderElement;
