-- Loans — a parent-tracked debt a child repays out of their balance.
--
-- A loan records a DEBT, not a transfer. Creating one credits the child
-- nothing: the parent already paid for the saxophone, and this tracks the
-- repayment. Money only ever moves on a payment, and only ever through
-- expense_application_balance_update.
--
-- ONE expenses ROW PER LOAN, not one per payment (loans.expense_id). Every
-- monthly payment is a single expense_applications row pointing back at that
-- one row, so a loan costs 1 row/month rather than 2. It also gives the
-- "already paid this calendar month?" check a natural home with no new table
-- and no new column on a shared one.

CREATE TABLE public.loans (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id         uuid NOT NULL REFERENCES public.families(id),
  member_id         uuid NOT NULL REFERENCES public.family_members(id),
  description       text NOT NULL,
  principal         numeric NOT NULL CHECK (principal > 0),
  monthly_payment   numeric NOT NULL CHECK (monthly_payment > 0),
  balance_remaining numeric NOT NULL CHECK (balance_remaining >= 0),
  -- Day of month the deduction is due. Capped at 28 so a loan cannot silently
  -- skip February.
  payment_day       smallint NOT NULL DEFAULT 5 CHECK (payment_day BETWEEN 1 AND 28),
  -- The single reserved-category expenses row every payment for this loan
  -- points at. Nullable only so the row can be inserted before the expense is
  -- created; loanService always populates it.
  expense_id        uuid REFERENCES public.expenses(id),
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paid_off','forgiven')),
  created_by        uuid REFERENCES public.family_members(id),
  created_at        timestamptz DEFAULT now(),
  -- Set for BOTH terminal statuses: it is the resolution timestamp, and the
  -- child-facing "paid off" / "forgiven" banner derives its 48-hour window
  -- from it.
  paid_off_at       timestamptz
);

-- ONE ACTIVE LOAN PER CHILD. Unique, not a plain lookup index: an app-side
-- check loses to two tablets tapping New Loan at once. Same reasoning as
-- idx_milestones_one_active_goal. Forgiving or paying off frees the slot.
-- It serves as the member lookup index too.
CREATE UNIQUE INDEX idx_loans_one_active_per_member
  ON public.loans(member_id) WHERE status = 'active';

ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;

-- RLS IS FAMILY-SCOPED, NOT CHILD-SCOPED, AND THAT IS DELIBERATE.
--
-- There is no policy here restricting a child to their own loans, because RLS
-- cannot express one in this app. The kiosk runs a single shared Supabase
-- session as the `Kiosk` parent row; child identity is app state
-- (useAuth.activeMember), not a session, so auth.uid() is the same parent no
-- matter which child is using the tablet. A policy written as "children see
-- only their own" would read as a security boundary while enforcing nothing.
--
-- The actual enforcement layer is the member_id filter in loanService's reads.
-- Identical situation to milestones.created_by_member — see the CHILD SAVINGS
-- GOALS notes in CLAUDE.md.
CREATE POLICY "Family members can view loans" ON public.loans FOR SELECT
  USING (family_id IN (
    SELECT family_id FROM public.family_members WHERE user_id = auth.uid()));

CREATE POLICY "Parents can manage loans" ON public.loans FOR ALL
  USING (public.is_family_parent(family_id))
  WITH CHECK (public.is_family_parent(family_id));
