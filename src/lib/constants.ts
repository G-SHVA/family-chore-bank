// Static reference data for the Family Chore Bank.
// NOTE: the chore & expense *libraries* live in Supabase (63 family chores,
// 26 family expenses). These constants cover things NOT in the DB yet:
// milestone suggestions, categories, and family id references.

export const FAMILY_ID = 'eaa7a6df-8ac6-40a5-8a5f-ced5dc745353'

export const CHORE_CATEGORIES = [
  'academic',
  'household',
  'personal',
  'pet-care',
] as const

export const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'] as const

/** Suggested milestones (savings goals). Parents can also create custom ones. */
export interface MilestoneTemplate {
  title: string
  target_amount: number
  icon: string
  badge_icon: string
}

export const MILESTONE_TEMPLATES: MilestoneTemplate[] = [
  { title: 'First $5 Saved', target_amount: 5, icon: 'piggy-bank', badge_icon: 'star' },
  { title: 'Saved $10', target_amount: 10, icon: 'piggy-bank', badge_icon: 'award' },
  { title: 'Saved $25', target_amount: 25, icon: 'target', badge_icon: 'medal' },
  { title: 'Saved $50', target_amount: 50, icon: 'target', badge_icon: 'trophy' },
  { title: 'Saved $100', target_amount: 100, icon: 'gem', badge_icon: 'crown' },
]

/** Suggested rewards parents can add. */
export interface RewardTemplate {
  title: string
  cost: number
  icon: string
}

export const REWARD_TEMPLATES: RewardTemplate[] = [
  { title: 'Extra 30 min screen time', cost: 1, icon: 'monitor' },
  { title: 'Pick the movie', cost: 2, icon: 'film' },
  { title: 'Ice cream trip', cost: 3, icon: 'ice-cream' },
  { title: 'Stay up 30 min late', cost: 2, icon: 'moon' },
  { title: 'Choose dinner', cost: 4, icon: 'utensils' },
]
