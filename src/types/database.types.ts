export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      chore_assignments: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assigned_by: string | null
          assigned_to: string
          chore_id: string
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          id: string
          is_active: boolean
          is_template: boolean
          notes: string | null
          recurrence_dow: number | null
          status: string | null
          template_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assigned_by?: string | null
          assigned_to: string
          chore_id: string
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          is_active?: boolean
          is_template?: boolean
          notes?: string | null
          recurrence_dow?: number | null
          status?: string | null
          template_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assigned_by?: string | null
          assigned_to?: string
          chore_id?: string
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          is_active?: boolean
          is_template?: boolean
          notes?: string | null
          recurrence_dow?: number | null
          status?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chore_assignments_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_assignments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chore_assignments_chore_id_fkey"
            columns: ["chore_id"]
            isOneToOne: false
            referencedRelation: "chores"
            referencedColumns: ["id"]
          },
        ]
      }
      chores: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          family_id: string | null
          frequency: string | null
          icon: string | null
          id: string
          is_archived: boolean
          is_custom: boolean
          is_template: boolean | null
          title: string
          updated_at: string | null
          value: number
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id?: string | null
          frequency?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_custom?: boolean
          is_template?: boolean | null
          title: string
          updated_at?: string | null
          value: number
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id?: string | null
          frequency?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_custom?: boolean
          is_template?: boolean | null
          title?: string
          updated_at?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "chores_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_applications: {
        Row: {
          amount: number
          applied_at: string | null
          created_at: string | null
          expense_id: string
          family_member_id: string
          id: string
        }
        Insert: {
          amount: number
          applied_at?: string | null
          created_at?: string | null
          expense_id: string
          family_member_id: string
          id?: string
        }
        Update: {
          amount?: number
          applied_at?: string | null
          created_at?: string | null
          expense_id?: string
          family_member_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_applications_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_applications_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          family_id: string | null
          icon: string | null
          id: string
          is_template: boolean | null
          title: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id?: string | null
          icon?: string | null
          id?: string
          is_template?: boolean | null
          title: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id?: string | null
          icon?: string | null
          id?: string
          is_template?: boolean | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          allow_notifications: boolean | null
          created_at: string | null
          currency: string | null
          data_collection: boolean | null
          id: string
          max_children: number | null
          max_parents: number | null
          member_pins: Json
          name: string
          share_progress: boolean | null
          stripe_customer_id: string | null
          subscription_tier: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          allow_notifications?: boolean | null
          created_at?: string | null
          currency?: string | null
          data_collection?: boolean | null
          id?: string
          max_children?: number | null
          max_parents?: number | null
          member_pins?: Json
          name: string
          share_progress?: boolean | null
          stripe_customer_id?: string | null
          subscription_tier?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_notifications?: boolean | null
          created_at?: string | null
          currency?: string | null
          data_collection?: boolean | null
          id?: string
          max_children?: number | null
          max_parents?: number | null
          member_pins?: Json
          name?: string
          share_progress?: boolean | null
          stripe_customer_id?: string | null
          subscription_tier?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      family_members: {
        Row: {
          avatar_url: string | null
          balance: number | null
          created_at: string | null
          display_name: string | null
          family_id: string
          id: string
          is_active: boolean | null
          role: string[]
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          balance?: number | null
          created_at?: string | null
          display_name?: string | null
          family_id: string
          id?: string
          is_active?: boolean | null
          role: string[]
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          balance?: number | null
          created_at?: string | null
          display_name?: string | null
          family_id?: string
          id?: string
          is_active?: boolean | null
          role?: string[]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string
          family_id: string
          id: string
          invited_by: string | null
          placeholder_member_id: string | null
          role: string
          status: string | null
          token: string
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at: string
          family_id: string
          id?: string
          invited_by?: string | null
          placeholder_member_id?: string | null
          role: string
          status?: string | null
          token: string
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string
          family_id?: string
          id?: string
          invited_by?: string | null
          placeholder_member_id?: string | null
          role?: string
          status?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_placeholder_member_id_fkey"
            columns: ["placeholder_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_progress: {
        Row: {
          child_id: string
          completed_at: string | null
          created_at: string | null
          current_amount: number | null
          id: string
          milestone_id: string
        }
        Insert: {
          child_id: string
          completed_at?: string | null
          created_at?: string | null
          current_amount?: number | null
          id?: string
          milestone_id: string
        }
        Update: {
          child_id?: string
          completed_at?: string | null
          created_at?: string | null
          current_amount?: number | null
          id?: string
          milestone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_progress_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_progress_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          badge_icon: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          family_id: string
          icon: string | null
          id: string
          is_template: boolean | null
          target_amount: number
          title: string
        }
        Insert: {
          badge_icon?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id: string
          icon?: string | null
          id?: string
          is_template?: boolean | null
          target_amount: number
          title: string
        }
        Update: {
          badge_icon?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id?: string
          icon?: string | null
          id?: string
          is_template?: boolean | null
          target_amount?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string | null
          currency: string | null
          description: string | null
          family_id: string
          id: string
          metadata: Json | null
          payment_method: string | null
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          subscription_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          family_id: string
          id?: string
          metadata?: Json | null
          payment_method?: string | null
          status: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          family_id?: string
          id?: string
          metadata?: Json | null
          payment_method?: string | null
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_subscriptions: {
        Row: {
          created_at: string | null
          email: string
          expires_at: string | null
          family_name: string | null
          full_name: string
          id: string
          plan_tier: string
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          expires_at?: string | null
          family_name?: string | null
          full_name: string
          id?: string
          plan_tier: string
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          expires_at?: string | null
          family_name?: string | null
          full_name?: string
          id?: string
          plan_tier?: string
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      plan_availability: {
        Row: {
          description: string | null
          display_name: string
          is_available: boolean
          plan_tier: string
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          display_name: string
          is_available?: boolean
          plan_tier: string
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          display_name?: string
          is_available?: boolean
          plan_tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      reward_redemptions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          fulfilled_at: string | null
          id: string
          notes: string | null
          redeemed_by: string
          reward_id: string
          status: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          fulfilled_at?: string | null
          id?: string
          notes?: string | null
          redeemed_by: string
          reward_id: string
          status?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          fulfilled_at?: string | null
          id?: string
          notes?: string | null
          redeemed_by?: string
          reward_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards: {
        Row: {
          cost: number
          created_at: string | null
          created_by: string | null
          description: string | null
          family_id: string
          icon: string | null
          id: string
          is_available: boolean | null
          is_template: boolean | null
          title: string
        }
        Insert: {
          cost: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id: string
          icon?: string | null
          id?: string
          is_available?: boolean | null
          is_template?: boolean | null
          title: string
        }
        Update: {
          cost?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family_id?: string
          icon?: string | null
          id?: string
          is_available?: boolean | null
          is_template?: boolean | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "rewards_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          family_id: string
          id: string
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          family_id: string
          id?: string
          plan_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          family_id?: string
          id?: string
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: true
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_get_user_emails: {
        Args: { user_ids: string[] }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      apply_expense: {
        Args: { p_expense_id: string; p_member_id: string }
        Returns: undefined
      }
      approve_chore: {
        Args: { p_assignment_id: string; p_approved_by: string }
        Returns: undefined
      }
      can_manage_family_invitations: {
        Args: { check_family_id: string }
        Returns: boolean
      }
      cleanup_expired_pending_subscriptions: { Args: never; Returns: undefined }
      complete_paid_subscription: {
        Args: {
          p_plan_tier: string
          p_stripe_customer_id: string
          p_stripe_subscription_id: string
          p_user_id: string
        }
        Returns: {
          error_message: string
          family_id: string
          subscription_id: string
          success: boolean
        }[]
      }
      get_current_user_email: { Args: never; Returns: string }
      is_app_admin: { Args: never; Returns: boolean }
      is_family_admin: { Args: { check_family_id: string }; Returns: boolean }
      is_family_parent: { Args: { check_family_id: string }; Returns: boolean }
      is_plan_available: { Args: { p_plan_tier: string }; Returns: boolean }
      user_belongs_to_family: {
        Args: { check_family_id: string }
        Returns: boolean
      }
      user_has_admin_role: { Args: never; Returns: boolean }
      user_has_role: {
        Args: { check_family_id: string; check_role: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
