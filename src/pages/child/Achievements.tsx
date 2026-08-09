import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Flame, Gift, Users, Target, TrendingUp } from 'lucide-react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import {
  getAchievementsOverview,
  getFamilyProgress,
  type AchievementsOverview,
  type FamilyProgress,
} from '@/features/chores/choreService'
import { getMilestoneProgress, type MilestoneWithProgress } from '@/features/milestones/milestoneService'
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
    const [ov, ms, rw, fp] = await Promise.all([
      getAchievementsOverview(memberId),
      getMilestoneProgress(familyId, memberId),
      getAvailableRewards(familyId, myBalance),
      getFamilyProgress(children),
    ])
    setOverview(ov)
    setMilestones(ms)
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
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex flex-wrap gap-1 rounded-input bg-card p-1">
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

      {tab === 'overview' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-gold">
                <Flame className="h-7 w-7" />
              </div>
              <div>
                <div className="text-3xl font-extrabold">{overview.currentStreak}</div>
                <div className="text-sm text-text-muted">
                  Day streak · best {overview.longestStreak}
                </div>
              </div>
            </Card>
            <Card className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green/15 text-green">
                <TrendingUp className="h-7 w-7" />
              </div>
              <div>
                <div className="text-3xl font-extrabold text-green">
                  {formatCurrency(overview.totalEarned, currency)}
                </div>
                <div className="text-sm text-text-muted">Total earned</div>
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
            <div className="mb-3 font-bold">Last 7 days</div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={overview.sevenDay}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#A0A0A0', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {overview.sevenDay.map((d, i) => (
                      <Cell key={i} fill={d.count > 0 ? '#E6B800' : '#2A2A2A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {tab === 'milestones' && (
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
                  <div className="truncate font-bold">{m.title}</div>
                  <div className="text-sm text-text-muted">
                    {formatCurrency(m.currentAmount, currency)} /{' '}
                    {formatCurrency(m.target_amount, currency)}
                  </div>
                  {m.completedAt && <div className="text-sm font-semibold text-green">Unlocked!</div>}
                </div>
              </Card>
            ))
          )}
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
                  <div className="flex items-center gap-2 font-bold">
                    <Gift className="h-5 w-5 text-gold" /> {r.title}
                  </div>
                  <div className="mt-1 text-2xl font-extrabold text-gold">
                    {formatCurrency(r.cost, currency)}
                  </div>
                  <div className="mt-3">
                    {requested ? (
                      <div className="text-center text-sm font-semibold text-green">Sent to parents!</div>
                    ) : r.canAfford ? (
                      <Button fullWidth onClick={() => handleRedeem(r.id)}>
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
              <Users className="h-6 w-6 text-gold" />
              <span className="font-bold">Family total</span>
            </div>
            <span className="text-2xl font-extrabold text-green">
              {formatCurrency(familyProgress.familyTotalBalance, currency)}
            </span>
          </Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {familyProgress.children.map((c) => (
              <Card key={c.member.id}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">{c.member.display_name}</span>
                  {c.currentStreak > 0 && (
                    <span className="flex items-center gap-1 text-sm text-gold">
                      <Flame className="h-4 w-4" /> {c.currentStreak}d
                    </span>
                  )}
                </div>
                <div className="mt-2 text-2xl font-extrabold text-green">
                  {formatCurrency(c.member.balance ?? 0, currency)}
                </div>
                <div className="text-sm text-text-muted">
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

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-2xl font-extrabold">{value}</span>
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
    </Card>
  )
}

function Ring({ pct, done }: { pct: number; done: boolean }) {
  const r = 26
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#2A2A2A" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={done ? '#42B883' : '#E6B800'}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="fill-text text-[14px] font-bold">
        {pct}%
      </text>
    </svg>
  )
}
