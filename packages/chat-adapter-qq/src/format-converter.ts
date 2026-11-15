import type { Root } from 'chat';
import { BaseFormatConverter, parseMarkdown, stringifyMarkdown } from 'chat';

/**
 * The `@` markers QQ rewrites an @-mention into, for the ids the payload does not name: a numeric
 * account id (`<@!11586990140073229091>` in `protocol-spec.md` §7.1), a `member_openid` of 12 hex
 * characters (§6.1) or 32 as live payloads carry, either optionally prefixed with `!`, or the
 * group broadcast `<@all>`.
 *
 * Only the lengths the specs and live payloads use are matched, so text such as `<@foo>` or
 * `<@abcdef0123456789>` is left alone. Markers whose id the payload does name are removed by id
 * instead — see `cleanMentions`.
 */
const MENTION_MARKER = /<@!?(?:all|\d+|[0-9A-Fa-f]{12}|[0-9A-Fa-f]{32})>/g;
const CHANNEL_MARKER = /<#\d+>/g;

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
   *
   * `mentionedIds` are the ids the event itself reported; dropping by id first keeps any id shape
   * out of the text, then the remaining markers are removed by their known forms.
   */
  cleanMentions(text: string, mentionedIds: readonly string[] = []): string {
    const withoutNamed = mentionedIds.reduce(
      (cleaned, id) => cleaned.replaceAll(new RegExp(`<@!?${escapeRegExp(id)}>`, 'g'), ''),
      text,
    );

    return withoutNamed
      .replaceAll(MENTION_MARKER, '')
      .replaceAll('<@everyone>', '')
      .replaceAll(CHANNEL_MARKER, '')
      .trim();
  }
}
