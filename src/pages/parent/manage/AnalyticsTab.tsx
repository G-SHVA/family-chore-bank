import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Flame, Trophy } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { isChild } from '@/features/family/familyService'
import {
  RANGE_OPTIONS,
  resolveRange,
  toChildRefs,
  loadResolvedAssignments,
  loadApprovedAssignments,
  loadExpenseApplications,
  buildCompletion,
  buildFinancial,
  buildEconomy,
  type AssignmentRow,
  type ExpenseRow,
  type RangeKey,
} from '@/features/analytics/analyticsService'
import { Card } from '@/components/ui/Card'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { cn, formatCurrency } from '@/lib/utils'

/* Chart palette — design tokens only (DESIGN_SYSTEM.md §1). Antique gold leads
   because primary gold is reserved for the one action button per screen, and a
   chart is not an action. Series cycle when a family has more than two kids. */
const ANTIQUE = '#E0BC84'
const GREEN = '#4A9B6F'
const MUTED = '#8A8680'
const DANGER = '#E05252'
const TRACK = 'rgba(224,188,132,0.10)'
const SERIES = [ANTIQUE, GREEN, MUTED]
const seriesColor = (i: number) => SERIES[i % SERIES.length]

const AXIS = { fill: MUTED, fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' }

/* Every chart sets isAnimationActive={false}. Recharts' entry animation replays
   in full on each data change, so switching the date range left the bars at zero
   height for ~400ms — on a dashboard that reads as "the chart is broken", and it
   fooled us during review before we checked the DOM. The range pills are the
   primary interaction here, so instant redraw beats the flourish. */

/* ------------------------------------------------------------------ *
 * Async plumbing — one hook per dataset so a slow query only blocks the
 * sections that actually need it.
 * ------------------------------------------------------------------ */

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    run()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            loading: false,
            error: e instanceof Error ? e.message : 'Could not load this data.',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [run])

  return state
}

/* ------------------------------------------------------------------ *
 * Presentational primitives
 * ------------------------------------------------------------------ */

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-wash', className)} />
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 border border-danger/40 bg-danger/10 p-4 text-danger">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

function EmptyNote({ children }: { children: string }) {
  return (
    <Card>
      <p className="text-sm text-text-muted">{children}</p>
    </Card>
  )
}

/** Small label + figure. `tone` colours the figure only. */
function StatCard({
  label,
  value,
  tone,
  sub,
  icon,
  large,
}: {
  label: string
  value: string
  tone?: 'green' | 'danger' | 'antique'
  sub?: string
  icon?: React.ReactNode
  large?: boolean
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="label-caps flex items-center gap-1.5 text-[10px] text-text-muted">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'display',
          large ? 'text-4xl' : 'text-2xl',
          tone === 'green'
            ? 'text-green'
            : tone === 'danger'
              ? 'text-danger'
              : tone === 'antique'
                ? 'text-antique'
                : 'text-text'
        )}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-text-muted">{sub}</span>}
    </Card>
  )
}

function SubHeading({ children, note }: { children: string; note?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-lg">{children}</h3>
      {note && <p className="text-xs text-text-muted">{note}</p>}
    </div>
  )
}

/** Dark card, antique hairline — the tooltip spec in the design brief. */
function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean
  payload?: { name?: string; value?: number | string; color?: string }[]
  label?: string | number
  format?: (v: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="border border-antique bg-deep px-3 py-2 text-xs">
      {label !== undefined && label !== '' && (
        <div className="label-caps mb-1 text-[10px] text-text-muted">{label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-text">
          <span
            className="inline-block h-2 w-2 shrink-0"
            style={{ backgroundColor: p.color ?? ANTIQUE }}
          />
          <span>{p.name}</span>
          <span className="ml-auto font-semibold text-antique">
            {typeof p.value === 'number' && format ? format(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Tab
 * ------------------------------------------------------------------ */

export default function AnalyticsTab() {
  const { family, members } = useAuth()
  const currency = family?.currency ?? 'USD'
  const children = useMemo(() => toChildRefs(members.filter(isChild)), [members])
  const childKey = children.map((c) => c.id).join(',')

  const [rangeKey, setRangeKey] = useState<RangeKey>('month')
  const range = useMemo(() => resolveRange(rangeKey), [rangeKey])

  const resolved = useAsync<AssignmentRow[]>(
    () => loadResolvedAssignments(children, range),
    [childKey, rangeKey]
  )
  const approved = useAsync<AssignmentRow[]>(
    () => loadApprovedAssignments(children, range),
    [childKey, rangeKey]
  )
  const expenses = useAsync<ExpenseRow[]>(
    () => loadExpenseApplications(children, range),
    [childKey, rangeKey]
  )

  const money = (v: number) => formatCurrency(v, currency)

  return (
    <div className="flex flex-col gap-6">
      {/* Global range filter — outside every section, so it never scrolls away
          and always describes what all three sections below are showing. */}
      <div className="flex flex-wrap gap-1 border border-line bg-deep p-1">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setRangeKey(o.key)}
            className={cn(
              'label-caps min-h-touch flex-1 px-3 py-2 text-[11px]',
              rangeKey === o.key ? 'bg-wash text-antique' : 'text-text-muted'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {children.length === 0 ? (
        <EmptyNote>Add a child in Settings to start collecting analytics.</EmptyNote>
      ) : (
        <>
          <CollapsibleSection title="Completion performance" maxHeight={500} defaultOpen>
            {resolved.loading ? (
              <SectionSkeleton />
            ) : resolved.error ? (
              <SectionError message={resolved.error} />
            ) : (
              <CompletionSection
                data={buildCompletion(children, resolved.data ?? [])}
                money={money}
              />
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Financial ledger summary" maxHeight={500}>
            {approved.loading || expenses.loading ? (
              <SectionSkeleton />
            ) : approved.error || expenses.error ? (
              <SectionError message={approved.error ?? expenses.error ?? ''} />
            ) : (
              <FinancialSection
                data={buildFinancial(children, approved.data ?? [], expenses.data ?? [], range)}
                money={money}
              />
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Family economy health" maxHeight={500}>
            {resolved.loading || approved.loading ? (
              <SectionSkeleton />
            ) : resolved.error || approved.error ? (
              <SectionError message={resolved.error ?? approved.error ?? ''} />
            ) : (
              <EconomySection
                data={buildEconomy(children, resolved.data ?? [], approved.data ?? [], range)}
                money={money}
                rangeKey={rangeKey}
              />
            )}
          </CollapsibleSection>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Section 1 — Completion Performance
 * ------------------------------------------------------------------ */

function CompletionSection({
  data,
  money,
}: {
  data: ReturnType<typeof buildCompletion>
  money: (v: number) => string
}) {
  void money
  if (data.isEmpty) {
    return (
      <EmptyNote>
        Completion data will appear here as children complete their first chores.
      </EmptyNote>
    )
  }

  return (
    <div className="flex flex-col gap-6 pr-1">
      {/* 1a */}
      <div>
        <SubHeading note="Completed chores vs all assigned and missed">
          Completion rate
        </SubHeading>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.byChild} margin={{ top: 18, right: 8, bottom: 4, left: 0 }}>
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis
                domain={[0, 100]}
                tick={AXIS}
                axisLine={false}
                tickLine={false}
                width={42}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                cursor={{ fill: TRACK }}
                content={<ChartTooltip format={(v) => `${v}%`} />}
              />
              <Bar
                dataKey="rate"
                name="Completion"
                radius={0}
                maxBarSize={64}
                isAnimationActive={false}
              >
                {data.byChild.map((c, i) => (
                  <Cell key={c.childId} fill={seriesColor(i)} />
                ))}
                <LabelList
                  dataKey="rate"
                  position="top"
                  formatter={(v: number) => `${v}%`}
                  style={{ fill: MUTED, fontSize: 11 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 1b */}
      <div>
        <SubHeading>Streaks</SubHeading>
        <div className="grid grid-cols-2 gap-3">
          {data.streaks.map((s) => (
            <Card key={s.childId} className="flex flex-col gap-1">
              <span className="label-caps flex items-center gap-1.5 text-[10px] text-text-muted">
                <Flame className="h-3.5 w-3.5 text-antique" />
                {s.name}
              </span>
              <span className="display text-2xl text-text">{s.current}d current</span>
              <span className="text-xs text-text-muted">{s.longest}d longest</span>
            </Card>
          ))}
        </div>
      </div>

      {/* 1c + 1d */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopList title="Most completed" groups={data.topCompleted} tone="antique" />
        <TopList title="Most missed" groups={data.topMissed} tone="muted" />
      </div>

      {/* 1e */}
      <div>
        <SubHeading note="Both children combined">Completion rate by category</SubHeading>
        {data.byCategory.length === 0 ? (
          <p className="text-sm text-text-muted">No categories in this range.</p>
        ) : (
          <div style={{ height: Math.max(120, data.byCategory.length * 34 + 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.byCategory}
                layout="vertical"
                margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
              >
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                  width={96}
                />
                <Tooltip
                  cursor={{ fill: TRACK }}
                  content={<ChartTooltip format={(v) => `${v}%`} />}
                />
                <Bar
                  dataKey="rate"
                  name="Completion"
                  fill={ANTIQUE}
                  background={{ fill: TRACK }}
                  barSize={16}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="rate"
                    position="right"
                    formatter={(v: number) => `${v}%`}
                    style={{ fill: MUTED, fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

function TopList({
  title,
  groups,
  tone,
}: {
  title: string
  groups: { childId: string; name: string; items: { title: string; count: number }[] }[]
  tone: 'antique' | 'muted'
}) {
  return (
    <div>
      <SubHeading>{title}</SubHeading>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.childId} className="flex flex-col gap-2">
            <span className="label-caps text-[10px] text-text-muted">{g.name}</span>
            {g.items.length === 0 ? (
              <span className="text-xs text-text-muted">Nothing yet.</span>
            ) : (
              g.items.map((it) => (
                <div key={it.title} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-text">{it.title}</span>
                  <span
                    className={cn(
                      'label-caps shrink-0 border px-2 py-0.5 text-[10px]',
                      tone === 'antique'
                        ? 'border-antique/40 text-antique'
                        : 'border-line text-text-muted'
                    )}
                  >
                    {it.count}
                  </span>
                </div>
              ))
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Section 2 — Financial Ledger Summary
 * ------------------------------------------------------------------ */

function FinancialSection({
  data,
  money,
}: {
  data: ReturnType<typeof buildFinancial>
  money: (v: number) => string
}) {
  if (data.isEmpty) {
    return (
      <EmptyNote>
        Earnings and expense history will appear here after the first chores are approved.
      </EmptyNote>
    )
  }

  return (
    <div className="flex flex-col gap-6 pr-1">
      {/* 2a */}
      <div>
        <SubHeading>Total earned</SubHeading>
        <div className="grid grid-cols-2 gap-3">
          {data.byChild.map((c) => (
            <StatCard key={c.childId} label={c.name} value={money(c.earned)} tone="green" large />
          ))}
        </div>
      </div>

      {/* 2b */}
      <div>
        <SubHeading>Total expenses charged</SubHeading>
        <div className="grid grid-cols-2 gap-3">
          {data.byChild.map((c) => (
            <StatCard key={c.childId} label={c.name} value={money(c.spent)} tone="danger" />
          ))}
        </div>
      </div>

      {/* 2c */}
      <div>
        <SubHeading>Net balance change</SubHeading>
        <div className="grid grid-cols-2 gap-3">
          {data.byChild.map((c) => (
            <StatCard
              key={c.childId}
              label={c.name}
              value={money(c.net)}
              tone={c.net >= 0 ? 'green' : 'danger'}
            />
          ))}
        </div>
      </div>

      {/* 2d */}
      <div>
        <SubHeading note="Dollars approved each week">Earning trend</SubHeading>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.trend} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
              <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis
                tick={AXIS}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => money(v)}
              />
              <Tooltip content={<ChartTooltip format={(v) => money(v)} />} />
              {data.trendChildren.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  name={name}
                  stroke={seriesColor(i)}
                  strokeWidth={2}
                  dot={{ r: 2, fill: seriesColor(i) }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Two lines need naming; there is no way to label them in place. */}
        <div className="mt-1 flex flex-wrap gap-3">
          {data.trendChildren.map((name, i) => (
            <span key={name} className="flex items-center gap-1.5 text-xs text-text-muted">
              <span
                className="inline-block h-0.5 w-4"
                style={{ backgroundColor: seriesColor(i) }}
              />
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* 2e */}
      <div>
        <SubHeading note="Categories reflect how expenses were labeled when created.">
          Expense breakdown by category
        </SubHeading>
        {data.expenseByCategory.length === 0 ? (
          <p className="text-sm text-text-muted">No expenses applied in this range.</p>
        ) : (
          <div style={{ height: Math.max(120, data.expenseByCategory.length * 34 + 24) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.expenseByCategory}
                layout="vertical"
                margin={{ top: 4, right: 56, bottom: 4, left: 0 }}
              >
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="category"
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                  width={96}
                />
                <Tooltip cursor={{ fill: TRACK }} content={<ChartTooltip format={money} />} />
                <Bar
                  dataKey="amount"
                  name="Charged"
                  fill={DANGER}
                  background={{ fill: TRACK }}
                  barSize={16}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="amount"
                    position="right"
                    formatter={(v: number) => money(v)}
                    style={{ fill: MUTED, fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 2f */}
      <div>
        <SubHeading note="Awarded = credited by a parent without the child completing a chore">
          Earned vs awarded
        </SubHeading>
        <div className="grid grid-cols-2 gap-3">
          {data.byChild.map((c) => (
            <Card key={c.childId} className="flex flex-col gap-1">
              <span className="label-caps text-[10px] text-text-muted">{c.name}</span>
              <span className="text-sm text-text">
                Earned:{' '}
                <span className="display font-semibold text-green">{money(c.fromChores)}</span>
                <span className="mx-2 text-text-muted">|</span>
                Awarded:{' '}
                <span className="display font-semibold text-antique">{money(c.fromAwards)}</span>
              </span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Section 3 — Family Economy Health
 * ------------------------------------------------------------------ */

function EconomySection({
  data,
  money,
  rangeKey,
}: {
  data: ReturnType<typeof buildEconomy>
  money: (v: number) => string
  rangeKey: RangeKey
}) {
  if (data.isEmpty) {
    return (
      <EmptyNote>
        Family comparison data will appear here once both children have activity.
      </EmptyNote>
    )
  }

  const turnaround =
    data.turnaroundHours === null
      ? '—'
      : data.turnaroundHours < 1
        ? `${Math.round(data.turnaroundHours * 60)}m`
        : `${data.turnaroundHours.toFixed(1)}h`

  return (
    <div className="flex flex-col gap-6 pr-1">
      {/* 3a — three charts rather than one, because chores, dollars and percent
          cannot share a Y axis without one of them being invisible. */}
      <div>
        <SubHeading note="Same scale within each metric, so the two bars are directly comparable">
          Side by side
        </SubHeading>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MiniCompare
            title="Chores completed"
            rows={data.comparison}
            dataKey="completed"
            format={(v) => `${v}`}
          />
          <MiniCompare
            title="Total earned"
            rows={data.comparison}
            dataKey="earned"
            format={money}
          />
          <MiniCompare
            title="Completion rate"
            rows={data.comparison}
            dataKey="rate"
            format={(v) => `${v}%`}
            domain={[0, 100]}
          />
        </div>
      </div>

      {/* 3b */}
      <StatCard
        label="Total family economy"
        value={money(data.totalEconomy)}
        tone="green"
        large
        sub="Combined earnings for both children this period"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* 3c */}
        <StatCard
          label="Approval turnaround"
          value={turnaround}
          tone="antique"
          sub={
            data.turnaroundSample > 0
              ? `Average across ${data.turnaroundSample} approved chore${data.turnaroundSample === 1 ? '' : 's'}`
              : 'No completed chores approved in this range'
          }
        />

        {/* 3d */}
        <Card className="flex flex-col gap-1">
          <span className="label-caps text-[10px] text-text-muted">Earning growth</span>
          {data.growthPercent === null ? (
            <>
              <span className="display text-2xl text-text">—</span>
              <span className="text-xs text-text-muted">
                {rangeKey === 'all'
                  ? 'All Time has no prior period to compare.'
                  : 'No earnings in the prior period to compare against.'}
              </span>
            </>
          ) : (
            <>
              <span
                className={cn(
                  'display flex items-center gap-1 text-2xl',
                  data.growthPercent >= 0 ? 'text-green' : 'text-danger'
                )}
              >
                {data.growthPercent >= 0 ? (
                  <ArrowUpRight className="h-5 w-5" />
                ) : (
                  <ArrowDownRight className="h-5 w-5" />
                )}
                {data.growthPercent >= 0 ? '+' : ''}
                {data.growthPercent}%
              </span>
              <span className="text-xs text-text-muted">
                {money(data.currentEarned)} vs {money(data.priorEarned)} prior
              </span>
            </>
          )}
        </Card>

        {/* 3e */}
        <Card className="flex flex-col gap-1">
          <span className="label-caps flex items-center gap-1.5 text-[10px] text-text-muted">
            <Trophy className="h-3.5 w-3.5 text-antique" />
            Most valuable chore
          </span>
          {data.topChore ? (
            <>
              <span className="display text-2xl text-antique">{money(data.topChore.value)}</span>
              <span className="text-xs text-text-muted">
                {data.topChore.title} · {data.topChore.childName}
              </span>
            </>
          ) : (
            <span className="display text-2xl text-text">—</span>
          )}
        </Card>
      </div>
    </div>
  )
}

function MiniCompare({
  title,
  rows,
  dataKey,
  format,
  domain,
}: {
  title: string
  rows: { name: string; completed: number; earned: number; rate: number }[]
  dataKey: 'completed' | 'earned' | 'rate'
  format: (v: number) => string
  domain?: [number, number]
}) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="label-caps text-[10px] text-text-muted">{title}</span>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
            <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis hide domain={domain ?? [0, 'auto']} />
            <Tooltip cursor={{ fill: TRACK }} content={<ChartTooltip format={format} />} />
            <Bar dataKey={dataKey} name={title} maxBarSize={48} isAnimationActive={false}>
              {rows.map((r, i) => (
                <Cell key={r.name} fill={seriesColor(i)} />
              ))}
              <LabelList
                dataKey={dataKey}
                position="top"
                formatter={format}
                style={{ fill: MUTED, fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
