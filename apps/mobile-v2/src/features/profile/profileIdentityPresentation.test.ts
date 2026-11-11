import test from 'node:test';
import assert from 'node:assert/strict';
import {profileAvatarInitials,profileIdentityDisplay} from './profileIdentityPresentation.ts';
test('private profile identity uses the saved name, never the private email',()=>{
 assert.equal(profileIdentityDisplay('  Alex   Athlete '),'Alex Athlete');
 assert.equal(profileAvatarInitials('  Alex   Athlete '),'AA');
 assert.equal(profileAvatarInitials('Runner'),'R');
});
test('unset or blank display name uses a non-identifying placeholder',()=>{
 assert.equal(profileIdentityDisplay(null),'Your Profile');
 assert.equal(profileAvatarInitials(null),'A');
 assert.equal(profileAvatarInitials('  '),'A');
 assert.equal(profileIdentityDisplay(''),'Your Profile');
});
test('Unicode initials are derived from display name and capped to two glyphs',()=>{
 assert.equal(profileAvatarInitials('Émilie Tremblay'),'ÉT');
 assert.equal(profileAvatarInitials('Mountain Trail Runner'),'MR');
});
