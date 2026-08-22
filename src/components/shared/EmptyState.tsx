import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'

export function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-14 text-center">
      <Icon className="h-12 w-12 text-antique/60" strokeWidth={1.25} />
      <div>
        <div className="display text-xl text-text">{title}</div>
        {subtitle && <div className="mt-1 text-sm text-text-muted">{subtitle}</div>}
      </div>
    </Card>
  )
}
