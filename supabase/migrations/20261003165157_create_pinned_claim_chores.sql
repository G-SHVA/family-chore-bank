CREATE TABLE public.pinned_claim_chores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  chore_id uuid NOT NULL REFERENCES public.chores(id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pinned_claim_chores_pkey PRIMARY KEY (id),
  CONSTRAINT pinned_claim_chores_unique UNIQUE (family_member_id, chore_id)
);

CREATE INDEX idx_pinned_claim_chores_member ON public.pinned_claim_chores (family_member_id);

ALTER TABLE public.pinned_claim_chores ENABLE ROW LEVEL SECURITY;

-- Family-scoped, not child-scoped: the kiosk runs one shared session, so RLS cannot
-- tell which child is acting. The member_id filter in the service is the real boundary.
CREATE POLICY "Family members manage own family pins"
  ON public.pinned_claim_chores
  FOR ALL
  TO authenticated
  USING (
    family_member_id IN (
      SELECT fm.id FROM public.family_members fm
      WHERE fm.family_id IN (
        SELECT me.family_id FROM public.family_members me WHERE me.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    family_member_id IN (
      SELECT fm.id FROM public.family_members fm
      WHERE fm.family_id IN (
        SELECT me.family_id FROM public.family_members me WHERE me.user_id = auth.uid()
      )
    )
  );

COMMENT ON TABLE public.pinned_claim_chores IS 'A child''s pinned favourite claim-library chores. Cap of 5 enforced in app code. RLS is family-scoped by design (shared kiosk session).';
