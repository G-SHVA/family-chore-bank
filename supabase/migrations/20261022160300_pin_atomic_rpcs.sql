-- Atomic PIN helpers for the verify-pin / set-pin edge functions. Service-role only.

-- Reserve one attempt BEFORE the bcrypt compare. The row lock serializes concurrent callers, so a
-- burst of parallel guesses cannot all see "0 failures". Lock when the count reaches p_max, then
-- double on every further attempt (60s, 120s, 240s ... capped at 1h). A quiet hour resets the count.
-- Locked callers are refused WITHOUT being counted. The edge function deletes the row on success.
CREATE OR REPLACE FUNCTION public.pin_attempt_begin(
  p_member_id uuid, p_max int DEFAULT 5, p_base_seconds int DEFAULT 60)
RETURNS TABLE (is_locked boolean, locked_until timestamptz, attempts_used int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count   int;
  v_window  timestamptz;
  v_locked  timestamptz;
  v_new_lock timestamptz;
BEGIN
  INSERT INTO pin_attempts (member_id, failed_count, window_started_at, locked_until)
  VALUES (p_member_id, 0, now(), NULL)
  ON CONFLICT (member_id) DO NOTHING;

  SELECT pa.failed_count, pa.window_started_at, pa.locked_until
    INTO v_count, v_window, v_locked
  FROM pin_attempts pa WHERE pa.member_id = p_member_id
  FOR UPDATE;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RETURN QUERY SELECT true, v_locked, v_count;
    RETURN;
  END IF;

  IF v_window < now() - interval '1 hour' THEN
    v_count := 0;
    v_window := now();
  END IF;

  v_count := v_count + 1;
  v_new_lock := CASE WHEN v_count >= p_max
    THEN now() + make_interval(secs => LEAST(3600, p_base_seconds * power(2, v_count - p_max)))
    ELSE NULL END;

  UPDATE pin_attempts pa
     SET failed_count = v_count, window_started_at = v_window, locked_until = v_new_lock
   WHERE pa.member_id = p_member_id;

  RETURN QUERY SELECT false, v_new_lock, v_count;
END;
$$;

-- Set a PIN only if none exists, atomically (no read-modify-write of the whole JSON blob).
CREATE OR REPLACE FUNCTION public.set_member_pin_if_absent(
  p_family_id uuid, p_member_id uuid, p_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n int;
BEGIN
  UPDATE families f
     SET member_pins = COALESCE(f.member_pins, '{}'::jsonb) || jsonb_build_object(p_member_id::text, p_hash)
   WHERE f.id = p_family_id
     AND COALESCE(f.member_pins ->> p_member_id::text, '') = ''
     AND EXISTS (SELECT 1 FROM family_members fm WHERE fm.id = p_member_id AND fm.family_id = p_family_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_member_pin(p_family_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE families SET member_pins = COALESCE(member_pins, '{}'::jsonb) - p_member_id::text
   WHERE id = p_family_id;
$$;

REVOKE ALL ON FUNCTION public.pin_attempt_begin(uuid,int,int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_member_pin_if_absent(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_member_pin(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pin_attempt_begin(uuid,int,int) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_member_pin_if_absent(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_member_pin(uuid,uuid) TO service_role;
