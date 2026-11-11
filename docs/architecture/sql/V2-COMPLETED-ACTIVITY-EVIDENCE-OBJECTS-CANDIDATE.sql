-- ALL-243 REVIEW ONLY. Not a migration or a Storage policy.
-- Source-linked opaque metadata, not uploaded or verified measurements.
BEGIN;
CREATE TABLE public.v2_activity_series (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL, user_id uuid NOT NULL,
 source_id uuid NOT NULL, segment_id uuid,
 metric_code text NOT NULL, definition_version integer NOT NULL,
 object_path text NOT NULL UNIQUE, encoding text NOT NULL
  CHECK(encoding IN ('fit','compressed_json','protobuf')),
 checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
 sample_count integer NOT NULL CHECK(sample_count BETWEEN 1 AND 10000000),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 quality text NOT NULL CHECK(quality IN ('trusted','partial','unverified','low_quality','rejected')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','rejected','revoked')),
 FOREIGN KEY(activity_id,user_id) REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(source_id,activity_id,user_id) REFERENCES public.v2_activity_sources(id,activity_id,user_id),
 FOREIGN KEY(segment_id,activity_id,user_id) REFERENCES public.v2_activity_segments(id,activity_id,user_id),
 FOREIGN KEY(metric_code,definition_version) REFERENCES public.v2_activity_metric_definitions(metric_code,definition_version),
 CHECK(ends_at>=starts_at),
 CHECK(length(object_path) BETWEEN 80 AND 500),
 CHECK(left(object_path,length(user_id::text)+1)=user_id::text||'/'),
 CHECK(strpos(object_path,'..')=0 AND strpos(object_path,'//')=0)
);
CREATE TABLE public.v2_activity_route_objects (
 id uuid PRIMARY KEY, activity_id uuid NOT NULL, user_id uuid NOT NULL,
 source_id uuid NOT NULL, object_path text NOT NULL UNIQUE,
 format text NOT NULL CHECK(format IN ('fit','gpx','encoded_route')),
 checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
 point_count integer NOT NULL CHECK(point_count BETWEEN 1 AND 5000000),
 quality text NOT NULL CHECK(quality IN ('trusted','partial','unverified','low_quality','rejected')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','rejected','revoked')),
 privacy_state text NOT NULL DEFAULT 'private' CHECK(privacy_state IN ('private','redacted')),
 FOREIGN KEY(activity_id,user_id) REFERENCES public.v2_completed_activities(id,user_id),
 FOREIGN KEY(source_id,activity_id,user_id) REFERENCES public.v2_activity_sources(id,activity_id,user_id),
 UNIQUE(activity_id,user_id,source_id,checksum_sha256),
 CHECK(length(object_path) BETWEEN 80 AND 500),
 CHECK(left(object_path,length(user_id::text)+1)=user_id::text||'/'),
 CHECK(strpos(object_path,'..')=0 AND strpos(object_path,'//')=0)
);
CREATE INDEX v2_series_owner_lookup ON public.v2_activity_series(user_id,activity_id,metric_code,state);
CREATE INDEX v2_routes_owner_lookup ON public.v2_activity_route_objects(user_id,activity_id,state,privacy_state);
ALTER TABLE public.v2_activity_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_activity_route_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.v2_activity_series FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.v2_activity_route_objects FROM PUBLIC,anon,authenticated;
COMMIT;
-- No Storage bucket, direct app grants, object reader, or device attestation.
