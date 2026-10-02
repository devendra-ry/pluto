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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      generation_jobs: {
        Row: {
          claim_expires_at: string | null
          claim_token: string | null
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          model_id: string | null
          reasoning_effort: string | null
          status: string
          system_prompt: string | null
          thread_id: string
          updated_at: string
          user_id: string
          user_message_id: string
        }
        Insert: {
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          model_id?: string | null
          reasoning_effort?: string | null
          status?: string
          system_prompt?: string | null
          thread_id: string
          updated_at?: string
          user_id?: string
          user_message_id: string
        }
        Update: {
          claim_expires_at?: string | null
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          model_id?: string | null
          reasoning_effort?: string | null
          status?: string
          system_prompt?: string | null
          thread_id?: string
          updated_at?: string
          user_id?: string
          user_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_delete_audit: {
        Row: {
          actor_user_id: string
          anchor_message_id: string | null
          created_at: string
          id: string
          message_ids: string[]
          reason: string
          restored_at: string | null
          thread_id: string
        }
        Insert: {
          actor_user_id: string
          anchor_message_id?: string | null
          created_at?: string
          id?: string
          message_ids: string[]
          reason?: string
          restored_at?: string | null
          thread_id: string
        }
        Update: {
          actor_user_id?: string
          anchor_message_id?: string | null
          created_at?: string
          id?: string
          message_ids?: string[]
          reason?: string
          restored_at?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_delete_audit_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          content: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          model_id: string | null
          reasoning: string | null
          reply_stats: Json | null
          reply_to_message_id: string | null
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          attachments?: Json
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          model_id?: string | null
          reasoning?: string | null
          reply_stats?: Json | null
          reply_to_message_id?: string | null
          role: string
          thread_id: string
          user_id?: string
        }
        Update: {
          attachments?: Json
          content?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          model_id?: string | null
          reasoning?: string | null
          reply_stats?: Json | null
          reply_to_message_id?: string | null
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_cleanup_jobs: {
        Row: {
          attempts: number
          available_at: string
          claim_expires_at: string | null
          claim_token: string | null
          created_at: string
          id: string
          last_error: string | null
          paths: string[]
          status: string
          thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          available_at: string
          claim_expires_at?: string | null
          claim_token?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          paths?: string[]
          status?: string
          thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          available_at?: string
          claim_expires_at?: string | null
          claim_token?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          paths?: string[]
          status?: string
          thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      threads: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_pinned: boolean
          model: string | null
          reasoning_effort: string | null
          system_prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_pinned?: boolean
          model?: string | null
          reasoning_effort?: string | null
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_pinned?: boolean
          model?: string | null
          reasoning_effort?: string | null
          system_prompt?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    // Refine nullable RPC contracts from SQL defaults and return definitions.
    // Supabase CLI type generation does not retain this PostgreSQL nullability.
    Functions: {
      attachment_path_thread_id: {
        Args: { p_path: string; p_user_id: string }
        Returns: string | null
      }
      attachment_paths: { Args: { p_attachments: Json }; Returns: string[] }
      branch_thread: {
        Args: { p_anchor_message_id: string; p_parent_thread_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_pinned: boolean
          model: string | null
          reasoning_effort: string | null
          system_prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_pending_generation_job: {
        Args: {
          p_lease_seconds?: number
          p_thread_id: string
          p_user_message_id?: string | null
        }
        Returns: {
          claim_token: string
          id: string
          model_id: string
          reasoning_effort: string | null
          system_prompt: string | null
          user_message_id: string
        }[]
      }
      claim_thread_cleanup_jobs: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: {
          claim_token: string
          job_id: string
          paths: string[]
          thread_id: string
        }[]
      }
      cleanup_empty_new_chat_threads: {
        Args: { exclude_thread_id?: string }
        Returns: number
      }
      complete_generation_job:
        | {
            Args: {
              p_claim_token: string
              p_error?: string
              p_job_id: string
              p_status: string
            }
            Returns: boolean
          }
        | {
            Args: { p_error?: string; p_job_id: string; p_status: string }
            Returns: boolean
          }
      delete_thread: {
        Args: { p_thread_id: string }
        Returns: {
          deleted_at: string
          thread_id: string
          undo_until: string
        }[]
      }
      edit_user_message: {
        Args: {
          p_attachments: Json
          p_content: string
          p_message_id: string
          p_model_id: string
          p_thread_id: string
        }
        Returns: {
          deleted_message_ids: string[]
          user_message_id: string
        }[]
      }
      fail_thread_cleanup_job: {
        Args: { p_claim_token: string; p_error: string; p_job_id: string }
        Returns: boolean
      }
      finish_thread_cleanup_job: {
        Args: { p_claim_token: string; p_job_id: string }
        Returns: boolean
      }
      persist_generation_response: {
        Args: {
          p_claim_token: string
          p_content: string
          p_job_id: string
          p_model_id: string
          p_reasoning: string
          p_reply_stats?: Json
        }
        Returns: string
      }
      restore_soft_deleted_messages: {
        Args: { p_message_ids: string[]; p_restore_window_minutes?: number }
        Returns: number
      }
      restore_thread: {
        Args: { p_thread_id: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          is_pinned: boolean
          model: string | null
          reasoning_effort: string | null
          system_prompt: string | null
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "threads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      soft_delete_messages: {
        Args: {
          p_anchor_message_id?: string | null
          p_message_ids: string[]
          p_reason?: string
        }
        Returns: number
      }
      start_chat_with_message: {
        Args: {
          p_attachments: Json
          p_content: string
          p_model: string
          p_reasoning_effort: string | null
          p_system_prompt: string | null
          p_thread_id?: string | null
        }
        Returns: {
          thread_id: string
          user_message_id: string
        }[]
      }
      thread_cleanup_path_is_claimed: {
        Args: { p_path: string; p_user_id: string }
        Returns: boolean
      }
      thread_folder_is_active_for_storage: {
        Args: { p_path: string; p_user_id: string }
        Returns: boolean
      }
      thread_path_is_referenced: {
        Args: { p_path: string; p_user_id: string }
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
