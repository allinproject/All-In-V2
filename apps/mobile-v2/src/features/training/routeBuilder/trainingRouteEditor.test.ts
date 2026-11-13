import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRouteWaypoint, buildAuthoritativeRouteEditRequest, buildRouteSaveCommand,
  createManualRouteEditor, deleteRouteWaypoint, moveRouteWaypoint,
  redoRouteEdit, reorderRouteWaypoint, setRouteEndpoint,
  setRouteShape, shapeRouteWithFreehand, undoRouteEdit,
} from './trainingRouteEditor.ts';

const start={latitude:44.75,longitude:-93.27};
const finish={latitude:44.76,longitude:-93.26};
test('route draft starts without provider geometry, verified distance, or save command',()=>{
 const state=createManualRouteEditor({sport:'run'});
 assert.equal(state.present.route,null);
 assert.equal(state.present.routeFresh,false);
 assert.equal(buildRouteSaveCommand(state),null);
 assert.equal(buildAuthoritativeRouteEditRequest(state),null);
});
test('start and end produce a provider-only edit request without invented measurements',()=>{
 const a=setRouteEndpoint(createManualRouteEditor({sport:'ride'}),'start',start);
 const b=setRouteEndpoint(a,'end',finish);
 const request=buildAuthoritativeRouteEditRequest(b);
 assert.equal(request?.sourcePolicy,'routing_map_provider_only');
 assert.equal(request?.allowArbitraryGeometry,false);
 assert.equal(request?.sport,'ride');
 assert.equal(buildRouteSaveCommand(b),null);
});
test('move, reorder, delete waypoint and undo/redo preserve editor history',()=>{
 let state=setRouteEndpoint(createManualRouteEditor({sport:'hike'}),'start',start);
 state=addRouteWaypoint(state,finish);
 const id=state.present.waypoints[0].id;
 state=moveRouteWaypoint(state,id,start);
 assert.deepEqual(state.present.waypoints[0].point,start);
 state=addRouteWaypoint(state,finish);
 state=reorderRouteWaypoint(state,id,1);
 assert.equal(state.present.waypoints[1].id,id);
 state=deleteRouteWaypoint(state,id);
 assert.equal(state.present.waypoints.length,1);
 const previous=undoRouteEdit(state);
 assert.equal(previous.present.waypoints.length,2);
 assert.equal(redoRouteEdit(previous).present.waypoints.length,1);
});
test('shape/freehand changes remain unsaved and require fresh provider rerouting',()=>{
 let state=createManualRouteEditor({sport:'ruck'});
 state=setRouteShape(state,'out_and_back');
 state=shapeRouteWithFreehand(state,[start,finish]);
 assert.equal(state.present.shape,'out_and_back');
 assert.equal(state.present.pendingFreehandTrace?.length,2);
 assert.equal(state.present.routeFresh,false);
 assert.equal(buildRouteSaveCommand(state),null);
});
