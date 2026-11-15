import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * The `@` markers QQ rewrites an @-mention into: a numeric id (`<@123>`, `<@!123>`), an
 * `member_openid` (`<@B2C3D4E5F6…>`, not always numeric), or the group broadcast (`<@all>`).
 * Anything else that happens to look like a marker — `<@foo>` in ordinary text — is left alone.
 */
const MENTION_MARKER = /<@(?:!?\d+|[0-9A-Fa-f]{16,}|all)>/g;
const CHANNEL_MARKER = /<#\d+>/g;

export class QQFormatConverter extends BaseFormatConverter {
  /**
   * Convert mdast AST to QQ-compatible text.
   * QQ supports basic text messages, we convert markdown to plain text for now.
   */
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  /**
   * Convert QQ message text to mdast AST.
   *
   * Strips markers through `cleanMentions`, so the two paths agree on what an @-mention is.
   */
  toAst(text: string): Root {
    return parseMarkdown(this.cleanMentions(text));
  }

  /**
   * Clean @mention markers from text.
   */
  cleanMentions(text: string): string {
    return text
      .replaceAll(MENTION_MARKER, '')
      .replaceAll('<@everyone>', '')
      .replaceAll(CHANNEL_MARKER, '')
      .trim();
  }
}
