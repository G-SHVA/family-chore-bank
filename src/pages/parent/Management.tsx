import { useState } from 'react'
import { cn } from '@/lib/utils'
import ChoresTab from './manage/ChoresTab'
import ExpensesTab from './manage/ExpensesTab'
import MilestonesTab from './manage/MilestonesTab'
import RewardsTab from './manage/RewardsTab'

type Tab = 'chores' | 'expenses' | 'milestones' | 'rewards'
const TABS: { key: Tab; label: string }[] = [
  { key: 'chores', label: 'Chores' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'rewards', label: 'Rewards' },
]

export default function Management() {
  const [tab, setTab] = useState<Tab>('chores')
  return (
    <div className="flex flex-col gap-6">
      <h1 className="spine pb-4 text-4xl">Manage</h1>

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
    </div>
  )
}
