/**
 * Shared ALL IN 365 social action vocabulary.
 *
 * Community, RaceHub and Public Profile must all use this same presentation
 * contract over the eventual canonical post/reaction service. This module
 * intentionally does not implement network writes, permissions or counters.
 */
export type CommunityPostKind = 'workout' | 'food' | 'update';
export type CommunityReactionState = {
  count: number;
  reactedByViewer: boolean;
};

export function propsActionLabel(reactedByViewer: boolean): 'Give Props' | 'Remove Props' {
  return reactedByViewer ? 'Remove Props' : 'Give Props';
}

export function propsCountLabel(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Props count must be a nonnegative integer.');
  return `Props · ${count}`;
}

export function commentCountLabel(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Comment count must be a nonnegative integer.');
  return `Comment · ${count}`;
}

export function communityPostPrimaryAction(kind: CommunityPostKind): 'completed-activity' | 'meal-prep' | 'post-detail' {
  if (kind === 'workout') return 'completed-activity';
  if (kind === 'food') return 'meal-prep';
  return 'post-detail';
}

// The primary destination is deliberately separate from the conversation.
export const communityPostCommentAction = 'post-comments' as const;
