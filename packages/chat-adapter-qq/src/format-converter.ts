import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * The `@` markers QQ rewrites an @-mention into: a numeric account id (`<@!11586990140073229091>`
 * in `protocol-spec.md` §7.1), a `member_openid` of hex characters (`F6A8B9C0D1E2` in §6.1, 32 in
 * live payloads), either optionally prefixed with `!`, or the group broadcast `<@all>`.
 *
 * The lower bound of 10 keeps ordinary text such as `<@foo>` out of the rewrite. Text that spells
 * out a long hex id inside `<>` is indistinguishable from a marker without the payload's
 * `mentions` list, which callers strip from separately.
 */
const MENTION_MARKER = /<@!?(?:all|\d+|[0-9A-Fa-f]{10,})>/g;
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
