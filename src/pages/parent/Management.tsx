import { useState } from 'react'
import { cn } from '@/lib/utils'
import ChoresTab from './manage/ChoresTab'
import ExpensesTab from './manage/ExpensesTab'
import MilestonesTab from './manage/MilestonesTab'
import RewardsTab from './manage/RewardsTab'
import LoansTab from './manage/LoansTab'

/**
 * "SETUP", NOT "MANAGE". A verb in the present continuous reads as an ongoing
 * duty; "Setup" reads as something already done. Nothing on this screen is
 * daily work, and the label was quietly implying otherwise.
 *
 * The ROUTE is still /parent/chores. Renaming a path that every link in the
 * app already points at would buy nothing and risk a dead link.
 *
 * ANALYTICS LEFT THIS SCREEN and now lives on Family Week — it is weekly-review
 * content, and this is a configuration area. See FamilyWeek.tsx.
 */
type Tab = 'chores' | 'expenses' | 'milestones' | 'rewards' | 'loans'
const TABS: { key: Tab; label: string }[] = [
  { key: 'chores', label: 'Chores' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'loans', label: 'Loans' },
]

export default function Management() {
  const [tab, setTab] = useState<Tab>('chores')
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="spine pb-4 text-4xl">Setup</h1>

      <div className="flex flex-wrap gap-1 rounded-input border border-line bg-deep p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'label-caps flex-1 rounded-input px-4 py-3 text-[11px]',
              tab === t.key ? 'bg-wash text-antique' : 'text-text-muted'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'chores' && <ChoresTab />}
      {tab === 'expenses' && <ExpensesTab />}
      {tab === 'milestones' && <MilestonesTab />}
      {tab === 'rewards' && <RewardsTab />}
      {tab === 'loans' && <LoansTab />}
    </div>
  )
}
