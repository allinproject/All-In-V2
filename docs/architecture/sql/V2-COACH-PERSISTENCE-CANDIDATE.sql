-- ALL-222 / ALL-210 / ALL-217: REVIEW-ONLY V2 Coach persistence candidate.
-- NOT in supabase/migrations. Do not execute on live V2 without architecture,
-- privacy, Edge-service and migration approval + local/restore acceptance.
-- One durable Coach conversation per authenticated V2 account.
-- No V1 JWT, thread, message or service dependency.
BEGIN;

CREATE TABLE public.v2_coach_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_coach_threads_one_per_owner UNIQUE (user_id),
  CONSTRAINT v2_coach_threads_owner_id_unique UNIQUE (user_id, id)
);

CREATE TABLE public.v2_coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (
    length(btrim(content)) > 0 AND octet_length(content) <= 32768
  ),
  client_action_id uuid,
  response_id uuid,
  reply_to_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v2_coach_messages_thread_owner_fk
    FOREIGN KEY (user_id, thread_id)
    REFERENCES public.v2_coach_threads (user_id, id) ON DELETE CASCADE,
  CONSTRAINT v2_coach_messages_owner_thread_id_unique UNIQUE (user_id, thread_id, id),
  CONSTRAINT v2_coach_messages_reply_owner_fk
    FOREIGN KEY (user_id, thread_id, reply_to_message_id)
    REFERENCES public.v2_coach_messages (user_id, thread_id, id),
  CONSTRAINT v2_coach_messages_role_ids CHECK (
    (role = 'user' AND client_action_id IS NOT NULL
      AND response_id IS NULL AND reply_to_message_id IS NULL)
    OR
    (role = 'assistant' AND response_id IS NOT NULL
      AND client_action_id IS NULL AND reply_to_message_id IS NOT NULL)
  ),
  CONSTRAINT v2_coach_messages_unique_action UNIQUE (user_id, client_action_id),
  CONSTRAINT v2_coach_messages_unique_reply UNIQUE (user_id, response_id)
);

CREATE INDEX v2_coach_messages_history_idx
  ON public.v2_coach_messages (user_id, thread_id, created_at DESC, id DESC);

-- Private audit of successful user append actions, not a second message store.
CREATE TABLE allin_private.v2_coach_message_actions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_action_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_action_id),
  FOREIGN KEY (user_id, thread_id, message_id)
    REFERENCES public.v2_coach_messages (user_id, thread_id, id) ON DELETE CASCADE
);

ALTER TABLE public.v2_coach_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_coach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE allin_private.v2_coach_message_actions ENABLE ROW LEVEL SECURITY;

-- No directly granted table access: the canonical RPCs own all reads/writes.
REVOKE ALL ON TABLE public.v2_coach_threads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.v2_coach_messages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE allin_private.v2_coach_message_actions
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.v2_coach_get_or_create_thread()
RETURNS TABLE (thread_id uuid, thread_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'unauthenticated or deleted account' USING ERRCODE = '28000';
  END IF;
  -- Unique(user_id) is the concurrency/first-open arbitration point.
  INSERT INTO public.v2_coach_threads(user_id)
  VALUES (v_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN QUERY
    SELECT t.id, t.version FROM public.v2_coach_threads t
    WHERE t.user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_coach_append_user_message(
  p_thread_id uuid,
  p_client_action_id uuid,
  p_content text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing public.v2_coach_messages%ROWTYPE;
  v_message_id uuid;
BEGIN
  IF v_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'unauthenticated or deleted account' USING ERRCODE = '28000';
  END IF;
  IF p_thread_id IS NULL OR p_client_action_id IS NULL OR p_content IS NULL
     OR length(btrim(p_content)) = 0 OR octet_length(p_content) > 32768 THEN
    RAISE EXCEPTION 'invalid message request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v2_coach_threads t
                 WHERE t.id = p_thread_id AND t.user_id = v_user_id) THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
  END IF;

  -- Single unique action index serializes concurrent identical retries.
  INSERT INTO public.v2_coach_messages
    (user_id, thread_id, role, content, client_action_id)
  VALUES (v_user_id, p_thread_id, 'user', p_content, p_client_action_id)
  ON CONFLICT (user_id, client_action_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT * INTO v_existing FROM public.v2_coach_messages
      WHERE user_id = v_user_id AND client_action_id = p_client_action_id;
    IF NOT FOUND OR v_existing.thread_id IS DISTINCT FROM p_thread_id
       OR v_existing.role <> 'user'
       OR v_existing.content IS DISTINCT FROM p_content THEN
      RAISE EXCEPTION 'action ID reused with different request'
        USING ERRCODE = '23505';
    END IF;
    v_message_id := v_existing.id;
  END IF;

  INSERT INTO allin_private.v2_coach_message_actions
    (user_id, client_action_id, thread_id, message_id)
  VALUES (v_user_id, p_client_action_id, p_thread_id, v_message_id)
  ON CONFLICT (user_id, client_action_id) DO NOTHING;

  RETURN v_message_id;
END;
$$;

-- Only the trusted V2 Coach Edge/service may write assistant replies.
-- Edge must authenticate the V2 bearer token, derive owner independently and
-- link the exact successful user message. A service-role JWT is privileged:
-- never expose this RPC through an end-user bearer token.
CREATE OR REPLACE FUNCTION public.v2_coach_record_assistant_reply(
  p_user_id uuid,
  p_thread_id uuid,
  p_user_message_id uuid,
  p_response_id uuid,
  p_content text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.v2_coach_messages%ROWTYPE;
  v_message_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_thread_id IS NULL OR p_user_message_id IS NULL
     OR p_response_id IS NULL OR p_content IS NULL
     OR length(btrim(p_content)) = 0 OR octet_length(p_content) > 32768 THEN
    RAISE EXCEPTION 'invalid assistant reply' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.v2_coach_messages m
    WHERE m.user_id = p_user_id AND m.thread_id = p_thread_id
      AND m.id = p_user_message_id AND m.role = 'user'
  ) THEN
    RAISE EXCEPTION 'invalid owner/thread/user message binding'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.v2_coach_messages
    (user_id, thread_id, role, content, reply_to_message_id, response_id)
  VALUES (p_user_id, p_thread_id, 'assistant', p_content,
          p_user_message_id, p_response_id)
  ON CONFLICT (user_id, response_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT * INTO v_existing FROM public.v2_coach_messages
      WHERE user_id = p_user_id AND response_id = p_response_id;
    IF NOT FOUND OR v_existing.thread_id IS DISTINCT FROM p_thread_id
       OR v_existing.reply_to_message_id IS DISTINCT FROM p_user_message_id
       OR v_existing.role <> 'assistant'
       OR v_existing.content IS DISTINCT FROM p_content THEN
      RAISE EXCEPTION 'response ID reused with different reply'
        USING ERRCODE = '23505';
    END IF;
    v_message_id := v_existing.id;
  END IF;
  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.v2_coach_read_messages(
  p_thread_id uuid,
  p_limit integer DEFAULT 50,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS TABLE (
  message_id uuid, message_role text, message_content text,
  message_created_at timestamptz, user_message_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'unauthenticated or deleted account' USING ERRCODE = '28000';
  END IF;
  IF p_thread_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL)) THEN
    RAISE EXCEPTION 'invalid history cursor or page size' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.v2_coach_threads t
    WHERE t.user_id = v_user_id AND t.id = p_thread_id
  ) THEN
    RAISE EXCEPTION 'thread not found' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT m.id, m.role, m.content, m.created_at, m.reply_to_message_id
    FROM public.v2_coach_messages m
    WHERE m.user_id = v_user_id AND m.thread_id = p_thread_id
      AND (p_before_created_at IS NULL OR
          (m.created_at, m.id) < (p_before_created_at, p_before_id))
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.v2_coach_get_or_create_thread() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_coach_append_user_message(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_coach_read_messages(uuid,integer,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.v2_coach_get_or_create_thread() TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_coach_append_user_message(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_coach_read_messages(uuid,integer,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.v2_coach_record_assistant_reply(uuid,uuid,uuid,uuid,text) TO service_role;

COMMENT ON TABLE public.v2_coach_threads IS
  'REVIEW-ONLY candidate: one persistent V2 Coach thread per owner; not deployed by this file.';
COMMENT ON TABLE public.v2_coach_messages IS
  'REVIEW-ONLY candidate: append-only, owner-scoped canonical Coach history.';
COMMIT;
