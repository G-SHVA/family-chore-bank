import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Flame, Gift, Users, Target, TrendingUp, Trophy, PiggyBank } from 'lucide-react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import {
  getAchievementsOverview,
  getFamilyProgress,
  type AchievementsOverview,
  type FamilyProgress,
} from '@/features/chores/choreService'
import { getMilestoneProgress, type MilestoneWithProgress } from '@/features/milestones/milestoneService'
import { getGoalHistory, withGoalProgress } from '@/features/goals/goalService'
import type { Milestone } from '@/lib/supabase'
import {
  getAvailableRewards,
  requestRedemption,
  type RewardWithAfford,
} from '@/features/rewards/rewardService'
import { getActiveMembers, isChild } from '@/features/family/familyService'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatCurrency } from '@/lib/utils'

type Tab = 'overview' | 'milestones' | 'rewards' | 'family'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'family', label: 'Family' },
]

export default function ChildAchievements() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const familyId = family?.id
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<AchievementsOverview | null>(null)
  const [milestones, setMilestones] = useState<MilestoneWithProgress[]>([])
  const [goals, setGoals] = useState<Milestone[]>([])
  const [rewards, setRewards] = useState<RewardWithAfford[]>([])
  const [familyProgress, setFamilyProgress] = useState<FamilyProgress | null>(null)
  const [balance, setBalance] = useState(0)
  const [redeemed, setRedeemed] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!memberId || !familyId) return
    const members = await getActiveMembers(familyId)
    const me = members.find((m) => m.id === memberId)
    const myBalance = me?.balance ?? 0
    setBalance(myBalance)
    const children = members.filter(isChild)
    const [ov, ms, rw, fp, gs] = await Promise.all([
      getAchievementsOverview(memberId),
      getMilestoneProgress(familyId, memberId),
      getAvailableRewards(familyId, myBalance),
      getFamilyProgress(children),
      getGoalHistory(memberId),
    ])
    setOverview(ov)
    setMilestones(ms)
    setGoals(gs)
    setRewards(rw)
    setFamilyProgress(fp)
    setLoading(false)
  }, [memberId, familyId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRedeem(rewardId: string) {
    if (!memberId) return
    setRedeemed((prev) => new Set(prev).add(rewardId))
    try {
      await requestRedemption(rewardId, memberId)
    } catch {
      setRedeemed((prev) => {
        const n = new Set(prev)
        n.delete(rewardId)
        return n
      })
    }
  }

  if (loading || !overview) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-wrap gap-1 rounded-input border border-line bg-deep p-1">
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

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-antique/40 bg-wash text-antique">
                <Flame className="h-7 w-7" />
              </div>
              <div>
                <div className="display text-3xl text-antique">{overview.currentStreak}</div>
                <div className="label-caps text-[10px] text-text-muted">
                  Day streak · best {overview.longestStreak}
                </div>
              </div>
            </Card>
            <Card className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-green/40 bg-green/10 text-green">
                <TrendingUp className="h-7 w-7" />
              </div>
              <div>
                <div className="display text-3xl text-green">
                  {formatCurrency(overview.totalEarned, currency)}
                </div>
                <div className="label-caps text-[10px] text-text-muted">Total earned</div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <StatBox label="Completion rate" value={`${overview.completionRate}%`} />
            <StatBox label="Chores completed" value={overview.totalCompleted} />
            <StatBox
              label="Earned this month"
              value={formatCurrency(overview.monthEarned, currency)}
            />
          </div>

          <Card>
            <h3 className="mb-3 text-xl">Last 7 days</h3>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overview.sevenDay}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#8A8680', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {overview.sevenDay.map((d, i) => (
                      <Cell key={i} fill={d.count > 0 ? '#E0BC84' : '#262628'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {tab === 'milestones' && (
        <div className="flex flex-col gap-6">
          {/* The child's OWN goals come first. A goal they chose means more than
              a milestone handed to them, and burying it under the family list
              would say the opposite. */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xl">My Goals</h3>
            {goals.length === 0 ? (
              <EmptyState
                icon={PiggyBank}
                title="No goals yet"
                subtitle="Set a savings goal on your home screen to start one."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {goals.map((g) => (
                  <GoalRecord key={g.id} goal={g} balance={balance} currency={currency} />
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-xl">Family Milestones</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {milestones.length === 0 ? (
                <div className="sm:col-span-2">
                  <EmptyState
                    icon={Target}
                    title="No milestones yet"
                    subtitle="Your parents can set savings goals for you to reach."
                  />
                </div>
              ) : (
                milestones.map((m) => (
                  <Card key={m.id} className="flex items-center gap-4">
                    <Ring pct={m.progressPct} done={!!m.completedAt} />
                    <div className="min-w-0">
                      <div className="display truncate text-lg">{m.title}</div>
                      <div className="text-sm text-text-muted">
                        {formatCurrency(m.currentAmount, currency)} /{' '}
                        {formatCurrency(m.target_amount, currency)}
                      </div>
                      {m.completedAt && (
                        <div className="label-caps text-[10px] text-green">Unlocked!</div>
                      )}
                    </div>
                  </Card>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'rewards' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <EmptyState
                icon={Gift}
                title="No rewards available"
                subtitle="Your parents can add rewards you can save up for."
              />
            </div>
          ) : (
            rewards.map((r) => {
              const requested = redeemed.has(r.id)
              return (
                <Card key={r.id} className={cn(!r.canAfford && 'opacity-60')}>
                  <div className="display flex items-center gap-2 text-lg">
                    <Gift className="h-5 w-5 text-antique" /> {r.title}
                  </div>
                  <div className="display mt-1 text-2xl text-antique">
                    {formatCurrency(r.cost, currency)}
                  </div>
                  <div className="mt-3">
                    {requested ? (
                      <div className="label-caps text-center text-[10px] text-green">Sent to parents!</div>
                    ) : r.canAfford ? (
                      <Button variant="accent" fullWidth onClick={() => handleRedeem(r.id)}>
                        Request
                      </Button>
                    ) : (
                      <div className="text-center text-sm text-text-muted">
                        Need {formatCurrency(r.cost - balance, currency)} more
                      </div>
                    )}
                  </div>
                </Card>
              )
            })
          )}
        </div>
      )}

      {tab === 'family' && familyProgress && (
        <div className="flex flex-col gap-4">
          <Card className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="h-6 w-6 text-antique" />
              <span className="label-caps text-xs">Family total</span>
            </div>
            <span className="display text-2xl text-green">
              {formatCurrency(familyProgress.familyTotalBalance, currency)}
            </span>
          </Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {familyProgress.children.map((c) => (
              <Card key={c.member.id}>
                <div className="flex items-center justify-between">
                  <span className="display text-lg">{c.member.display_name}</span>
                  {c.currentStreak > 0 && (
                    <span className="label-caps flex items-center gap-1 text-[11px] text-antique">
                      <Flame className="h-4 w-4" /> {c.currentStreak}d
                    </span>
                  )}
                </div>
                <div className="display mt-2 text-2xl text-green">
                  {formatCurrency(c.member.balance ?? 0, currency)}
                </div>
                <div className="label-caps text-[10px] text-text-muted">
                  This week {formatCurrency(c.weeklyEarnings, currency)}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One goal in the child's permanent record.
 *
 * An achieved goal is celebrated — trophy, the date, and the amount saved.
 * An abandoned one is recorded plainly and NOT celebrated: it is still part of
 * their financial history and worth seeing, but it is not an achievement.
 * An active goal shows live progress against the current balance.
 */
function GoalRecord({
  goal,
  balance,
  currency,
}: {
  goal: Milestone
  balance: number
  currency: string
}) {
  const achieved = goal.status === 'achieved'
  const abandoned = goal.status === 'abandoned'
  const live = withGoalProgress(goal, balance)
  const pct = achieved ? 100 : abandoned ? 0 : live.progressPct

  return (
    <Card className={cn('flex items-center gap-4', abandoned && 'opacity-60')}>
      {abandoned ? (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-line text-text-muted">
          <PiggyBank className="h-7 w-7" />
        </div>
      ) : achieved ? (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-green/40 bg-green/10 text-green">
          <Trophy className="h-7 w-7" />
        </div>
      ) : (
        <Ring pct={pct} done={false} />
      )}
      <div className="min-w-0">
        <div className="display truncate text-lg">{goal.title}</div>
        {achieved ? (
          <>
            <div className="text-sm text-text-muted">
              Saved {formatCurrency(goal.target_amount, currency)}
            </div>
            <div className="label-caps text-[10px] text-green">
              Achieved{goal.achieved_at ? ` \u00b7 ${formatGoalDate(goal.achieved_at)}` : ''}
            </div>
          </>
        ) : abandoned ? (
          <>
            <div className="text-sm text-text-muted">
              Goal was {formatCurrency(goal.target_amount, currency)}
            </div>
            <div className="label-caps text-[10px] text-text-muted">Abandoned</div>
          </>
        ) : (
          <>
            <div className="text-sm text-text-muted">
              {formatCurrency(live.savedAmount, currency)} /{' '}
              {formatCurrency(goal.target_amount, currency)}
            </div>
            <div className="label-caps text-[10px] text-antique">In progress</div>
          </>
        )}
      </div>
    </Card>
  )
}

function formatGoalDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="display text-2xl">{value}</span>
      <span className="label-caps text-[10px] text-text-muted">{label}</span>
    </Card>
  )
}

function Ring({ pct, done }: { pct: number; done: boolean }) {
  const r = 26
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#262628" strokeWidth="4" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={done ? '#4A9B6F' : '#E0BC84'}
        strokeWidth="4"
        strokeLinecap="butt"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="fill-text text-[13px] font-medium">
        {pct}%
      </text>
    </svg>
  )
}
