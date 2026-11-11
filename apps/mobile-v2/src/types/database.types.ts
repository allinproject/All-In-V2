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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      v2_legal_acceptances: {
        Row: {
          accepted_at: string
          age_18_confirmed: boolean
          client_action_id: string
          founder_beta_terms_version: string
          id: string
          privacy_version: string
          terms_version: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          age_18_confirmed: boolean
          client_action_id: string
          founder_beta_terms_version: string
          id?: string
          privacy_version: string
          terms_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          age_18_confirmed?: boolean
          client_action_id?: string
          founder_beta_terms_version?: string
          id?: string
          privacy_version?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: []
      }
      v2_legal_documents: {
        Row: {
          content_markdown: string
          content_sha256: string | null
          created_at: string
          document_key: string
          effective_at: string | null
          status: string
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          content_markdown: string
          content_sha256?: string | null
          created_at?: string
          document_key: string
          effective_at?: string | null
          status?: string
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          content_markdown?: string
          content_sha256?: string | null
          created_at?: string
          document_key?: string
          effective_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      v2_onboarding_progress: {
        Row: {
          completed_at: string | null
          completed_steps: string[]
          skipped_steps: string[]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          completed_steps?: string[]
          skipped_steps?: string[]
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          completed_steps?: string[]
          skipped_steps?: string[]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      v2_profile_settings: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      v2_profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      v2_accept_legal_documents: {
        Args: {
          p_age_18_confirmed: boolean
          p_client_action_id: string
          p_expected_user_id: string
          p_founder_beta_terms_version: string
          p_privacy_version: string
          p_terms_version: string
        }
        Returns: string
      }
      v2_my_health_considerations: { Args: { p_expected_user_id: string }; Returns: Json }
      v2_save_health_considerations: {
        Args: {
          p_expected_user_id: string
          p_conditions: Json
          p_limitations: Json
          p_coach_opt_in: boolean
          p_expected_version: number
        }
        Returns: number
      }
      v2_my_profile_state: { Args: never; Returns: Json }
      v2_patch_profile_settings_section: {
        Args: {
          p_client_action_id: string
          p_expected_user_id: string
          p_expected_version: number
          p_patch: Json
          p_section: string
        }
        Returns: number
      }
      v2_provider_cache_get: {
        Args: { p_cache_key: string; p_provider: string }
        Returns: Json
      }
      v2_provider_cache_prune_expired: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      v2_provider_cache_put: {
        Args: {
          p_cache_key: string
          p_expires_at: string
          p_fetched_at: string
          p_payload: Json
          p_provider: string
          p_source_license: string
          p_source_quality: string
        }
        Returns: boolean
      }
      v2_set_onboarding_step: {
        Args: {
          p_action: string
          p_client_action_id: string
          p_expected_user_id: string
          p_expected_version: number
          p_step: string
        }
        Returns: number
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
