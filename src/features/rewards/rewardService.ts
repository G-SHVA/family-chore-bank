import { supabase } from '@/lib/supabase'
import type { Reward, RewardRedemption } from '@/lib/supabase'

export interface RewardInput {
  title: string
  cost: number
  icon?: string | null
}

/** Create a family reward. */
export async function createReward(familyId: string, input: RewardInput): Promise<Reward> {
  const { data, error } = await supabase
    .from('rewards')
    .insert({
      family_id: familyId,
      title: input.title,
      cost: input.cost,
      icon: input.icon ?? null,
      is_available: true,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function toggleRewardAvailability(rewardId: string, isAvailable: boolean): Promise<void> {
  const { error } = await supabase
    .from('rewards')
    .update({ is_available: isAvailable })
    .eq('id', rewardId)
  if (error) throw error
}

/** All family rewards (available or not) for the management screen. */
export async function getRewards(familyId: string): Promise<Reward[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('*')
    .eq('family_id', familyId)
    .order('cost')
  if (error) throw error
  return data ?? []
}

export interface RedemptionRequest extends RewardRedemption {
  reward: { title: string | null; cost: number } | null
  member: { id: string; display_name: string | null; avatar_url: string | null } | null
}

/** Redemption requests (pending + approved-not-yet-fulfilled) for the parent queue. */
export async function getPendingRedemptions(): Promise<RedemptionRequest[]> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select(
      '*, reward:rewards(title,cost), member:family_members!reward_redemptions_redeemed_by_fkey(id,display_name,avatar_url)'
    )
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as RedemptionRequest[]
}

/**
 * Approve a redemption — status pending->approved. The
 * reward_redemption_balance_update trigger deducts the cost. NO balance code here.
 */
export async function approveRedemption(redemptionId: string, parentMemberId: string): Promise<void> {
  const { error } = await supabase
    .from('reward_redemptions')
    .update({ status: 'approved', approved_by: parentMemberId, approved_at: new Date().toISOString() })
    .eq('id', redemptionId)
    .eq('status', 'pending') // idempotent: only pending -> approved (avoids re-triggering deduction)
  if (error) throw error
}

/** Mark an approved redemption fulfilled (given to the child). No balance change. */
export async function fulfillRedemption(redemptionId: string): Promise<void> {
  const { error } = await supabase
    .from('reward_redemptions')
    .update({ status: 'fulfilled', fulfilled_at: new Date().toISOString() })
    .eq('id', redemptionId)
    .eq('status', 'approved')
  if (error) throw error
}

/** Reject a redemption request. No balance change. */
export async function rejectRedemption(redemptionId: string): Promise<void> {
  const { error } = await supabase
    .from('reward_redemptions')
    .update({ status: 'rejected' })
    .eq('id', redemptionId)
    .eq('status', 'pending')
  if (error) throw error
}

export interface RewardWithAfford extends Reward {
  canAfford: boolean
}

/** Available family rewards, flagged by whether the child can currently afford them. */
export async function getAvailableRewards(
  familyId: string,
  balance: number
): Promise<RewardWithAfford[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_available', true)
    .order('cost')
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r, canAfford: balance >= r.cost }))
}

/** Child requests to redeem a reward (status = pending; parent approves later). */
export async function requestRedemption(rewardId: string, memberId: string): Promise<void> {
  const { error } = await supabase
    .from('reward_redemptions')
    .insert({ reward_id: rewardId, redeemed_by: memberId, status: 'pending' })
  if (error) throw error
}

/** A child's redemption history (with reward info). */
export async function getMyRedemptions(memberId: string): Promise<RewardRedemption[]> {
  const { data, error } = await supabase
    .from('reward_redemptions')
    .select('*')
    .eq('redeemed_by', memberId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
