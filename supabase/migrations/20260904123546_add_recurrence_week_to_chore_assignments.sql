-- Monthly chores pinned to an Nth weekday ("2nd Wednesday").
--
-- OPTION B of the two considered: a second explicit column rather than
-- encoding week and day into recurrence_dow as (week * 10) + day. The encoded
-- form was rejected because it is NOT schema-change-free as it first appears --
-- chore_assignments_recurrence_dow_check caps that column at 6, so storing 23
-- would have meant dropping a live constraint and permanently losing its
-- ability to validate a weekday. It would also have made the column's meaning
-- conditional on chores.frequency, a column in a different table.
--
-- This mirrors the existing recurrence_dow pattern exactly: nullable smallint,
-- meaningful only on template rows, range CHECK, NULL = unpinned. Nullable
-- columns cost nothing when null, and this generates no additional rows.
--
-- NULL is the default, so all 1,786 existing rows are untouched and the three
-- pinned weekly rows keep working -- weekly ignores recurrence_week entirely.
ALTER TABLE public.chore_assignments
ADD COLUMN recurrence_week smallint
CHECK (recurrence_week IS NULL OR recurrence_week BETWEEN 1 AND 4);

COMMENT ON COLUMN public.chore_assignments.recurrence_week IS
  'Week of month (1-4) for monthly chores pinned to an Nth weekday. Paired with recurrence_dow: week=2, dow=3 means 2nd Wednesday. NULL = unpinned (weekly chores, and monthly chores due end of month). Only meaningful on template rows.';
