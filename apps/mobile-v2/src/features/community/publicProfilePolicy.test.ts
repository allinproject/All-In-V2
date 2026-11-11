import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePublicProfileView,canViewProfilePost,canDisplayRaceParticipation,
 type PublicProfileViewer} from './publicProfilePolicy.ts';
const viewer=(overrides:Partial<PublicProfileViewer>={}):PublicProfileViewer=>({
 ownerId:'athlete-A',viewerId:'athlete-B',profileVisibility:'private',
 relationship:'not_following',shareGeneralArea:false,sharedArea:'Saint Paul',...overrides,
});
test('private account requires follow approval; no private location by default',()=>{
 const v=evaluatePublicProfileView(viewer());
 assert.equal(v.canViewIdentity,true);
 assert.equal(v.canViewPrivateContent,false);
 assert.equal(v.canRequestToFollow,true);
 assert.equal(v.canFollowDirectly,false);
 assert.equal(v.visibleGeneralArea,null);
 assert.equal(canViewProfilePost('followers',v),false);
 assert.equal(canDisplayRaceParticipation('private',v),false);
});
test('pending follow does not grant access; approved follower sees follower content',()=>{
 const pending=evaluatePublicProfileView(viewer({relationship:'follow_requested'}));
 assert.equal(pending.label,'follow_request_pending');
 assert.equal(pending.canViewPrivateContent,false);
 const follower=evaluatePublicProfileView(viewer({relationship:'approved_follower'}));
 assert.equal(follower.canViewPrivateContent,true);
 assert.equal(canViewProfilePost('followers',follower),true);
 assert.equal(canViewProfilePost('private',follower),false);
});
test('public profile does not expose followers-only posts or races',()=>{
 const v=evaluatePublicProfileView(viewer({profileVisibility:'public'}));
 assert.equal(v.canFollowDirectly,true);
 assert.equal(canViewProfilePost('public',v),true);
 assert.equal(canViewProfilePost('followers',v),false);
 assert.equal(canDisplayRaceParticipation('followers',v),false);
 assert.equal(v.visibleGeneralArea,null);
});
test('block in either direction denies identity, interactions, posts and location',()=>{
 const v=evaluatePublicProfileView(viewer({profileVisibility:'public',relationship:'blocked_either_way',
  shareGeneralArea:true}));
 assert.equal(v.canViewIdentity,false);
 assert.equal(v.canInteract,false);
 assert.equal(v.visibleGeneralArea,null);
 assert.equal(canViewProfilePost('public',v),false);
});
test('own profile may view own private details without public sharing',()=>{
 const v=evaluatePublicProfileView(viewer({viewerId:'athlete-A',relationship:'self',
  shareGeneralArea:true}));
 assert.equal(v.canApproveRequests,true);
 assert.equal(canViewProfilePost('private',v),true);
 assert.equal(v.visibleGeneralArea,'Saint Paul');
});
test('relationship identity disagreement fails closed',()=>{
 assert.throws(()=>evaluatePublicProfileView(viewer({viewerId:'athlete-A',relationship:'approved_follower'})),/relationship/);
 assert.throws(()=>evaluatePublicProfileView(viewer({viewerId:'athlete-B',relationship:'self'})),/relationship/);
});
