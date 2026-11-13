/** V1 Route Builder provider/evidence types. Ported for ALL-246; no provider writer is approved. */
export type RouteSport='run'|'ride'|'hike'|'ruck';
export type RouteShape='loop'|'out_and_back'|'point_to_point'|'unknown';
export type RouteFacilityType='sidewalk'|'shared_use_path'|'paved_path'|'trail_singletrack'|'bike_facility'|'road_shoulder'|'roadway'|'unknown';
export type RouteSurface='paved'|'unpaved'|'gravel'|'dirt'|'rock'|'mixed'|'unknown';
export type RouteElevationSamples={intervalMeters:number;meters:number[]};
export type RouteTerrain='flat'|'rolling'|'hilly'|'mountainous'|'unknown';

export type TrainingRouteRequest={
 purpose:string;
 sport:RouteSport;
 origin:{latitude:number;longitude:number;accuracyMeters:number|null};
 targetDistanceMeters:number|null;
 targetElevationGainMeters:number|null;
 terrainPreference:RouteTerrain|null;
 shapePreference:Exclude<RouteShape,'unknown'>|null;
 preferFacilities:RouteFacilityType[];
 avoidFacilities:RouteFacilityType[];
 sourcePolicy:'routing_map_provider_only';
 retention:{persistLocation:false;createHomeLocationKnowledge:false};
 planMutationPolicy:'existing_preview_confirm_apply_only';
};

export type ProviderRouteSegment={
 id:string;
 startGeometryIndex:number;
 endGeometryIndex:number;
 distanceMeters:number;
 facilityType:RouteFacilityType;
 surface:RouteSurface;
 access:'public'|'private'|'restricted'|'prohibited'|'unknown';
 sportAccess:'allowed'|'prohibited'|'unknown';
 routable:true|false|'unknown';
 connected:true|false|'unknown';
 closure:'open'|'closed'|'unknown';
 direction:string|null;
};

export type RoutingProviderCandidate={
 source:{kind:'routing_map_provider';provider:string;providerRouteId:string;generatedAt:string;attribution:string};
 geometry:Array<{latitude:number;longitude:number}>;
 distanceMeters:number;
 elevationGainMeters:number|null;
 // Raw provider elevation samples along the route (see trainingRouteElevationProfile); absent when the provider gave none.
 elevationSamples?:RouteElevationSamples|null;
 terrain:RouteTerrain;
 shape:RouteShape;
 directions:string[];
 segments:ProviderRouteSegment[];
};

export type RouteCandidateRejectionReason=
 |'missing_provider_source'|'invalid_geometry'|'invalid_distance'|'missing_segments'|'segment_geometry_gap'
 |'disconnected_segment'|'non_routable_segment'|'private_or_restricted_segment'|'prohibited_sport_segment'
 |'unknown_access_or_connectivity'|'closed_or_unknown_closure'|'segment_distance_mismatch'|'impossible_distance_mismatch';

export type ValidatedTrainingRoute={
 provider:RoutingProviderCandidate['source'];
 geometry:RoutingProviderCandidate['geometry'];
 distanceMeters:number;
 elevationGainMeters:number|null;
 elevationSamples?:RouteElevationSamples|null;
 terrain:RouteTerrain;
 shape:RouteShape;
 directions:string[];
 segments:ProviderRouteSegment[];
 facilitySummary:Array<{facilityType:RouteFacilityType;distanceMeters:number;share:number}>;
 surfaceSummary:Array<{surface:RouteSurface;distanceMeters:number;share:number}>;
 warnings:string[];
 distanceDeviationPct:number|null;
 withinPracticalDistanceTolerance:boolean;
 rankScore:number;
};

export type PlannedTrainingRouteAttachmentPreview={
 action:'preview_route_attachment';
 planId:string;
 revision:number;
 dayIndex:number;
 workoutIndex:number;
 providerRouteId:string;
 provider:string;
 routeDistanceMeters:number;
 requiresExplicitConfirm:true;
 applyPolicy:'existing_preview_confirm_apply_only';
 previewEffect:'no_training_plan_mutation';
 rejectEffect:'none';
};

