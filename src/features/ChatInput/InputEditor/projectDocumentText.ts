import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';

import { $isReferTopicNode } from './ReferTopic/ReferTopicNode';

/**
 * Mirrors `ElementNode.getTextContent`, so the only thing that changes is the
 * decorator that has a tag form.
 */
const projectNode = (node: LexicalNode): string => {
  if ($isReferTopicNode(node)) return node.toTag();
  if (!$isElementNode(node)) return node.getTextContent();

  const children = node.getChildren();
  return children
    .map((child, index) => {
      const text = projectNode(child);
      // Block children are separated by a blank line, matching lexical.
      const needsBreak =
        $isElementNode(child) && index !== children.length - 1 && !child.isInline();
      return needsBreak ? `${text}\n\n` : text;
    })
    .join('');
};

/**
 * The composer document as text, one line per top-level block.
 *
 * The root's own projection adds a newline at every paragraph boundary and
 * repeats it around an empty paragraph, so a single typed blank line came back
 * as four newlines and every send grew the message. Projecting the top-level
 * blocks is the exact inverse of the text data source splitting on newlines.
 *
 * Nodes the runtime needs as tags keep their tag: a topic reference has to reach
 * the message text as `<refer_topic name id />`, because the context engine
 * resolves referenced conversations by parsing it out of the content.
 */
export const projectDocumentText = (): string =>
  $getRoot()
    .getChildren()
    .map((node) => projectNode(node))
    .join('\n');
