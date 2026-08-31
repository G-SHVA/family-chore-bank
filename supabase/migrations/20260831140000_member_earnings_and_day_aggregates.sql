-- Server-side aggregates for a child's approved history.
--
-- Fourth instance of the truncation class. getAchievementsOverview summed
-- lifetime earnings client-side from getApprovedInstances(), a capped array --
-- and a .limit(5000) above PostgREST's own max-rows is decorative, since the
-- server clips it silently. Lifetime money must never come from a capped read.
--
-- SECURITY INVOKER on purpose: these must stay subject to RLS, exactly like the
-- direct reads they replace. They aggregate rows the caller can already select,
-- so there is nothing to elevate.
--
-- Approved rows are never archived (archive_old_assignments moves only expired
-- and rejected), so the live table alone is the complete approved history and
-- these need no union against chore_assignments_archive.
CREATE OR REPLACE FUNCTION public.member_earnings_summary(
  p_member_id uuid,
  p_since timestamptz DEFAULT NULL
)
RETURNS TABLE (total_earned numeric, approved_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(sum(c.value), 0)::numeric AS total_earned,
         count(*)::bigint                   AS approved_count
  FROM public.chore_assignments ca
  JOIN public.chores c ON c.id = ca.chore_id
  WHERE ca.assigned_to = p_member_id
    AND ca.is_template = false
    AND ca.status = 'approved'
    AND (p_since IS NULL OR ca.approved_at >= p_since);
$$;

-- One row per DAY rather than per chore, so this grows with days elapsed
-- (~365/year) instead of chores approved. That is what lets the streak read
-- full history without a row cap.
--
-- roster_count excludes Direct Awards (template_id IS NULL): a parent handing
-- out money must not extend a chore streak. total_count keeps them, because the
-- activity chart is about money earned, not chores done.
CREATE OR REPLACE FUNCTION public.member_approved_day_counts(p_member_id uuid)
RETURNS TABLE (day date, total_count integer, roster_count integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT (ca.approved_at AT TIME ZONE 'America/Chicago')::date          AS day,
         count(*)::int                                                  AS total_count,
         count(*) FILTER (WHERE ca.template_id IS NOT NULL)::int        AS roster_count
  FROM public.chore_assignments ca
  WHERE ca.assigned_to = p_member_id
    AND ca.is_template = false
    AND ca.status = 'approved'
    AND ca.approved_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.member_earnings_summary(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.member_approved_day_counts(uuid) TO authenticated;
