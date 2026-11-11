/**
 * Pure Live Props lifecycle contract for the canonical V2 workout/Community owner.
 *
 * NO network, audio, feed, or database side effects. Backend must authenticate
 * each actor and enforce event membership, blocks and visibility in RLS/RPC.
 * A single workout/publication identity spans Community and EventHub.
 */
export type LivePropsPhase = 'live' | 'completed' | 'withdrawn';
export type LivePropsAudience = 'community' | 'eventhub';
export type LivePropsAnnouncement = Readonly<{
  ownerId: string;
  workoutId: string;
  postId: string;
  phase: LivePropsPhase;
  audiences: readonly LivePropsAudience[];
  eventId: string | null;
  // A post is never discoverable merely because an athlete started recording.
  optedIn: true;
  sharedFinalActivity: boolean;
}>;

export type LivePropsStart = Readonly<{
  ownerId: string;
  workoutId: string;
  postId: string;
  optedIn: boolean;
  shareToCommunity: boolean;
  eventId: string | null;
  shareToEventHub: boolean;
}>;

export function beginLiveProps(input: LivePropsStart): LivePropsAnnouncement | null {
  if (!input.optedIn) return null;
  const audiences: LivePropsAudience[] = [];
  if (input.shareToCommunity) audiences.push('community');
  if (input.shareToEventHub) {
    if (!input.eventId?.trim()) throw new Error('EventHub sharing requires a canonical event ID.');
    audiences.push('eventhub');
  }
  if (!audiences.length) return null;
  for (const id of [input.ownerId, input.workoutId, input.postId]) {
    if (!id.trim()) throw new Error('Owner, workout and canonical post identity are required.');
  }
  return {
    ownerId: input.ownerId, workoutId: input.workoutId, postId: input.postId,
    phase: 'live', audiences, eventId: input.shareToEventHub ? input.eventId : null,
    optedIn: true, sharedFinalActivity: false,
  };
}

export function finishLiveProps(
  live: LivePropsAnnouncement,
  outcome: 'shared' | 'private' | 'discarded',
): LivePropsAnnouncement {
  if (live.phase !== 'live') throw new Error('Only a live announcement can finish.');
  // Preserve the same post ID; do not mint a fresh social identity.
  if (outcome !== 'shared') return { ...live, phase: 'withdrawn', sharedFinalActivity: false };
  return { ...live, phase: 'completed', sharedFinalActivity: true };
}

export function isLivePropsVisible(
  announcement: LivePropsAnnouncement,
  audience: LivePropsAudience,
  eventId: string | null,
): boolean {
  if (announcement.phase === 'withdrawn' || !announcement.audiences.includes(audience)) return false;
  // This is only a cross-surface identity check, never an authorization grant.
  return audience !== 'eventhub' || Boolean(eventId && announcement.eventId === eventId);
}

export type PropsReactionKey = Readonly<{ postId: string; viewerId: string }>;

/** Use as the UNIQUE (post_id, viewer_id) key in the canonical reaction owner.
 * Reads and writes must still be authorized and checked server-side.
 */
export function propsReactionKey(announcement: LivePropsAnnouncement, viewerId: string): PropsReactionKey {
  if (!viewerId.trim()) throw new Error('Viewer identity is required.');
  if (viewerId === announcement.ownerId) throw new Error('Athletes cannot send Props to themselves.');
  if (announcement.phase === 'withdrawn') throw new Error('Workout is not shared.');
  return { postId: announcement.postId, viewerId };
}

/** Only an accepted first-ever reaction should be eligible for an audio cue.
 * The server must make this decision transactionally; retries are not new Props.
 */
export function mayQueueLiveCheer(
  announcement: LivePropsAnnouncement,
  insertedFirstReaction: boolean,
  athleteAllowsAudio: boolean,
): boolean {
  return announcement.phase === 'live' && insertedFirstReaction && athleteAllowsAudio;
}
