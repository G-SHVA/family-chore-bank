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
      <h1 className="text-3xl font-bold">Manage</h1>

      <div className="flex flex-wrap gap-1 rounded-input bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 rounded-md px-4 py-3 text-sm font-semibold',
              tab === t.key ? 'bg-gold text-bg' : 'text-text-muted'
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
