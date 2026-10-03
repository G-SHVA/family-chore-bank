/**
 * Shared ranked matching for every searchable list in the app: the parent
 * SearchableSelect dropdowns and the child claim-library search. One
 * implementation, so the two cannot drift apart again.
 *
 * WHY IT EXISTS. The first version only matched a prefix or an unbroken
 * substring, so "lawn mow" found nothing for "Mow Lawn" and a typo found
 * nothing at all. The family asked for Google-style forgiveness. Nothing is
 * ever excluded for being a weak match; weak matches simply sort last.
 *
 * TIERS, best first (0 means no match):
 *   1  exact          "mow lawn"  ->  Mow Lawn
 *   2  starts with    "mow"       ->  Mow Lawn
 *   3  contains       "awn"       ->  Mow Lawn
 *   4  every word, any order      "lawn mow"  ->  Mow Lawn
 *   5  typo tolerant  "vauum"     ->  Vacuum   (letters appear in order)
 *
 * TIER 5 IS GATED ON LENGTH. An in-order letter match on two or three
 * characters hits a large share of a 130-chore library ("og" is inside half of
 * it), which is noise, not forgiveness. It only applies from four characters.
 *
 * Order within a tier is the caller's original order (stable), so a list a
 * parent already sorted keeps its order.
 */

const MIN_FUZZY_LENGTH = 4

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when every character of `query` appears in `label`, in order. */
function isSubsequence(query: string, label: string): boolean {
  let from = 0
  for (const ch of query) {
    const at = label.indexOf(ch, from)
    if (at === -1) return false
    from = at + 1
  }
  return true
}

/** Rank one label against a query. 0 = no match; lower is better. */
export function rankMatch(query: string, label: string): number {
  const q = normalize(query)
  const l = normalize(label)
  if (!q) return 0
  if (l === q) return 1
  if (l.startsWith(q)) return 2
  if (l.includes(q)) return 3
  const words = q.split(' ')
  if (words.length > 1 && words.every((w) => l.includes(w))) return 4
  const squashed = q.replace(/ /g, '')
  if (squashed.length >= MIN_FUZZY_LENGTH && isSubsequence(squashed, l.replace(/ /g, ''))) return 5
  return 0
}

/**
 * Filter and order `items` by how well their label matches. An empty query is
 * not a search: it returns the list untouched.
 */
export function rankItems<T>(items: readonly T[], query: string, getLabel: (item: T) => string): T[] {
  if (!normalize(query)) return [...items]
  const hits: { item: T; rank: number; index: number }[] = []
  items.forEach((item, index) => {
    const rank = rankMatch(query, getLabel(item))
    if (rank > 0) hits.push({ item, rank, index })
  })
  hits.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return hits.map((h) => h.item)
}
