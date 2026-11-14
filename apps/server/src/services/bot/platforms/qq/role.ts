import { isRecord } from '@lobechat/utils/object';

export type QqMemberRole = 'admin' | 'member' | 'owner';

/** Read the group sender's role from the raw `GROUP_AT_MESSAGE_CREATE` payload. */
export function getQqGroupMemberRole(message: unknown): QqMemberRole | undefined {
  if (!isRecord(message) || !isRecord(message.raw) || !isRecord(message.raw.author))
    return undefined;

  const role = message.raw.author.member_role;
  if (role === 'member' || role === 'admin' || role === 'owner') return role;

  return undefined;
}
