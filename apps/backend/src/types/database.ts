export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      email_verification_tokens: {
        Row: {
          entry_id: string
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          entry_id: string
          expires_at: string
          id?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          entry_id?: string
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_verification_tokens_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id"]
          },
        ]
      }
      entries: {
        Row: {
          cancelled_at: string | null
          created_at: string
          custom_field_values: Json
          display_name: string
          email_verified_at: string | null
          free_text: string | null
          furigana: string
          id: string
          name: string
          participant_id: string
          status: Database["public"]["Enums"]["entry_status"]
          tournament_id: string
          updated_at: string
          waitlist_position: number | null
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          custom_field_values?: Json
          display_name: string
          email_verified_at?: string | null
          free_text?: string | null
          furigana: string
          id?: string
          name: string
          participant_id: string
          status?: Database["public"]["Enums"]["entry_status"]
          tournament_id: string
          updated_at?: string
          waitlist_position?: number | null
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          custom_field_values?: Json
          display_name?: string
          email_verified_at?: string | null
          free_text?: string | null
          furigana?: string
          id?: string
          name?: string
          participant_id?: string
          status?: Database["public"]["Enums"]["entry_status"]
          tournament_id?: string
          updated_at?: string
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "entries_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entries_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_regulations: {
        Row: {
          entry_id: string
          regulation_id: string
          tournament_id: string
        }
        Insert: {
          entry_id: string
          regulation_id: string
          tournament_id: string
        }
        Update: {
          entry_id?: string
          regulation_id?: string
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_regulations_entry_id_tournament_id_fkey"
            columns: ["entry_id", "tournament_id"]
            isOneToOne: false
            referencedRelation: "entries"
            referencedColumns: ["id", "tournament_id"]
          },
          {
            foreignKeyName: "entry_regulations_regulation_id_tournament_id_fkey"
            columns: ["regulation_id", "tournament_id"]
            isOneToOne: false
            referencedRelation: "regulations"
            referencedColumns: ["id", "tournament_id"]
          },
        ]
      }
      form_field_defs: {
        Row: {
          display_order: number
          field_key: string
          field_type: string
          id: string
          label: string
          options: Json | null
          required: boolean
          tournament_id: string
        }
        Insert: {
          display_order?: number
          field_key: string
          field_type: string
          id?: string
          label: string
          options?: Json | null
          required?: boolean
          tournament_id: string
        }
        Update: {
          display_order?: number
          field_key?: string
          field_type?: string
          id?: string
          label?: string
          options?: Json | null
          required?: boolean
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_field_defs_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_jobs: {
        Row: {
          body_html: string
          created_at: string
          failed: number
          id: string
          sent: number
          subject: string
          total: number
          tournament_id: string
          updated_at: string
        }
        Insert: {
          body_html: string
          created_at?: string
          failed?: number
          id?: string
          sent?: number
          subject: string
          total: number
          tournament_id: string
          updated_at?: string
        }
        Update: {
          body_html?: string
          created_at?: string
          failed?: number
          id?: string
          sent?: number
          subject?: string
          total?: number
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_jobs_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          created_at: string
          email: string
          email_verified_at: string | null
          id: string
          password_changed_at: string
          password_hash: string
          region_id: string
        }
        Insert: {
          created_at?: string
          email: string
          email_verified_at?: string | null
          id?: string
          password_changed_at?: string
          password_hash: string
          region_id: string
        }
        Update: {
          created_at?: string
          email?: string
          email_verified_at?: string | null
          id?: string
          password_changed_at?: string
          password_hash?: string
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_tokens: {
        Row: {
          expires_at: string
          id: string
          participant_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          expires_at: string
          id?: string
          participant_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          expires_at?: string
          id?: string
          participant_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "password_reset_tokens_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          allows_dual_entry: boolean
          id: string
          name: string
          slug: string
        }
        Insert: {
          allows_dual_entry?: boolean
          id?: string
          name: string
          slug: string
        }
        Update: {
          allows_dual_entry?: boolean
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      regulations: {
        Row: {
          closes_with_priority: boolean
          display_order: number
          id: string
          label: string
          priority_ends_at: string | null
          priority_starts_at: string | null
          tournament_id: string
        }
        Insert: {
          closes_with_priority?: boolean
          display_order?: number
          id?: string
          label: string
          priority_ends_at?: string | null
          priority_starts_at?: string | null
          tournament_id: string
        }
        Update: {
          closes_with_priority?: boolean
          display_order?: number
          id?: string
          label?: string
          priority_ends_at?: string | null
          priority_starts_at?: string | null
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulations_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_accounts: {
        Row: {
          created_at: string
          disabled_at: string | null
          email: string
          id: string
          password_hash: string
          region_id: string | null
          role: Database["public"]["Enums"]["staff_role"]
          sessions_valid_from: string
          tournament_type: Database["public"]["Enums"]["tournament_type"] | null
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          email: string
          id?: string
          password_hash: string
          region_id?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          sessions_valid_from?: string
          tournament_type?:
            | Database["public"]["Enums"]["tournament_type"]
            | null
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          email?: string
          id?: string
          password_hash?: string
          region_id?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          sessions_valid_from?: string
          tournament_type?:
            | Database["public"]["Enums"]["tournament_type"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_accounts_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_password_reset_tokens: {
        Row: {
          expires_at: string
          id: string
          staff_account_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          expires_at: string
          id?: string
          staff_account_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          expires_at?: string
          id?: string
          staff_account_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_password_reset_tokens_staff_account_id_fkey"
            columns: ["staff_account_id"]
            isOneToOne: false
            referencedRelation: "staff_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          capacity: number | null
          created_at: string
          display_order: number
          entries_paused: boolean
          entry_closes_at: string
          entry_opens_at: string
          id: string
          name: string | null
          question_set: string | null
          region_id: string
          type: Database["public"]["Enums"]["tournament_type"]
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          display_order?: number
          entries_paused?: boolean
          entry_closes_at: string
          entry_opens_at: string
          id?: string
          name?: string | null
          question_set?: string | null
          region_id: string
          type: Database["public"]["Enums"]["tournament_type"]
        }
        Update: {
          capacity?: number | null
          created_at?: string
          display_order?: number
          entries_paused?: boolean
          entry_closes_at?: string
          entry_opens_at?: string
          id?: string
          name?: string | null
          question_set?: string | null
          region_id?: string
          type?: Database["public"]["Enums"]["tournament_type"]
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_staff_password_link: {
        Args: {
          p_expires_at: string
          p_staff_account_id: string
          p_token_hash: string
        }
        Returns: undefined
      }
      cancel_own_entry: {
        Args: { p_entry_id: string; p_participant_id: string }
        Returns: {
          entry_tournament_id: string
          previous_status: Database["public"]["Enums"]["entry_status"]
        }[]
      }
      claim_participant_region: {
        Args: { p_participant_id: string; p_region_id: string }
        Returns: boolean
      }
      claim_participant_region_for_tournament: {
        Args: { p_participant_id: string; p_tournament_id: string }
        Returns: boolean
      }
      confirm_entry_by_token: {
        Args: { p_token_hash: string }
        Returns: Database["public"]["Enums"]["entry_status"]
      }
      custom_field_values_length: { Args: { p_values: Json }; Returns: number }
      disable_staff_account: {
        Args: { p_staff_account_id: string }
        Returns: undefined
      }
      enable_staff_account: {
        Args: { p_staff_account_id: string }
        Returns: undefined
      }
      import_tournament: {
        Args: {
          p_capacity: number
          p_entry_closes_at: string
          p_entry_opens_at: string
          p_form_fields: Json
          p_overwrite: boolean
          p_region_id: string
          p_regulations: Json
          p_type: Database["public"]["Enums"]["tournament_type"]
        }
        Returns: {
          created: boolean
          tournament_id: string
        }[]
      }
      issue_staff_password_link: {
        Args: {
          p_expires_at: string
          p_staff_account_id: string
          p_token_hash: string
        }
        Returns: undefined
      }
      lapse_expired_pending_entries: {
        Args: { p_participant_id: string }
        Returns: string[]
      }
      participant_holds_conflicting_region: {
        Args: { p_participant_id: string; p_tournament_id: string }
        Returns: boolean
      }
      promote_waitlisted_entries: {
        Args: { p_tournament_id: string }
        Returns: {
          entry_id: string
          participant_email: string
        }[]
      }
      record_mail_job_progress: {
        Args: { p_failed: number; p_job_id: string; p_sent: number }
        Returns: undefined
      }
      reenter_cancelled_entry: {
        Args: {
          p_custom_field_values: Json
          p_display_name: string
          p_entry_id: string
          p_free_text: string
          p_furigana: string
          p_name: string
          p_participant_id: string
        }
        Returns: {
          cancelled_at: string | null
          created_at: string
          custom_field_values: Json
          display_name: string
          email_verified_at: string | null
          free_text: string | null
          furigana: string
          id: string
          name: string
          participant_id: string
          status: Database["public"]["Enums"]["entry_status"]
          tournament_id: string
          updated_at: string
          waitlist_position: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "entries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reorder_tournaments: {
        Args: { p_tournament_ids: string[] }
        Returns: undefined
      }
      reset_participant_password: {
        Args: { p_password_hash: string; p_token_hash: string }
        Returns: undefined
      }
      reset_staff_password: {
        Args: { p_password_hash: string; p_token_hash: string }
        Returns: undefined
      }
      reset_tournament_entries: {
        Args: { p_delete_participants: boolean; p_tournament_id: string }
        Returns: {
          deleted_entry_count: number
          deleted_participant_count: number
          kept_participant_count: number
        }[]
      }
      sync_form_field_defs: {
        Args: { p_rows: Json; p_tournament_id: string }
        Returns: undefined
      }
      sync_regulations: {
        Args: { p_regulations: Json; p_tournament_id: string }
        Returns: undefined
      }
      take_over_unverified_participant: {
        Args: {
          p_participant_id: string
          p_password_hash: string
          p_region_id: string
        }
        Returns: string[]
      }
      tournament_entry_summary: {
        Args: never
        Returns: {
          cancelled_count: number
          capacity: number
          confirmed_count: number
          pending_verification_count: number
          region_id: string
          region_name: string
          region_slug: string
          tournament_id: string
          tournament_name: string
          tournament_type: Database["public"]["Enums"]["tournament_type"]
          waitlisted_count: number
        }[]
      }
    }
    Enums: {
      entry_status:
        | "pending_verification"
        | "confirmed"
        | "waitlisted"
        | "cancelled"
      staff_role: "regional" | "general"
      tournament_type: "saikyoi" | "shinjinou"
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
    Enums: {
      entry_status: [
        "pending_verification",
        "confirmed",
        "waitlisted",
        "cancelled",
      ],
      staff_role: ["regional", "general"],
      tournament_type: ["saikyoi", "shinjinou"],
    },
  },
} as const

