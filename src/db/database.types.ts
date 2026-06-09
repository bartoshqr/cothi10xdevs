export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      debates: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          root_node_id: string | null
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          root_node_id?: string | null
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          root_node_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "debates_root_node_id_fkey"
            columns: ["root_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      exchanges: {
        Row: {
          advocate_id: string
          challenger_id: string
          created_at: string
          current_round: number
          current_turn: Database["public"]["Enums"]["turn_actor"]
          debate_id: string
          id: string
          responded_at: string | null
          round_count: number
          status: Database["public"]["Enums"]["exchange_status"]
        }
        Insert: {
          advocate_id: string
          challenger_id: string
          created_at?: string
          current_round?: number
          current_turn?: Database["public"]["Enums"]["turn_actor"]
          debate_id: string
          id?: string
          responded_at?: string | null
          round_count: number
          status?: Database["public"]["Enums"]["exchange_status"]
        }
        Update: {
          advocate_id?: string
          challenger_id?: string
          created_at?: string
          current_round?: number
          current_turn?: Database["public"]["Enums"]["turn_actor"]
          debate_id?: string
          id?: string
          responded_at?: string | null
          round_count?: number
          status?: Database["public"]["Enums"]["exchange_status"]
        }
        Relationships: [
          {
            foreignKeyName: "exchanges_debate_id_fkey"
            columns: ["debate_id"]
            isOneToOne: false
            referencedRelation: "debates"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          author_id: string
          created_at: string
          debate_id: string
          id: string
          kind: Database["public"]["Enums"]["node_kind"]
          metadata: Json
          position_x: number
          position_y: number
        }
        Insert: {
          author_id: string
          created_at?: string
          debate_id: string
          id?: string
          kind: Database["public"]["Enums"]["node_kind"]
          metadata: Json
          position_x?: number
          position_y?: number
        }
        Update: {
          author_id?: string
          created_at?: string
          debate_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["node_kind"]
          metadata?: Json
          position_x?: number
          position_y?: number
        }
        Relationships: [
          {
            foreignKeyName: "nodes_debate_id_fkey"
            columns: ["debate_id"]
            isOneToOne: false
            referencedRelation: "debates"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          username?: string
        }
        Relationships: []
      }
      relations: {
        Row: {
          author_id: string
          created_at: string
          debate_id: string
          id: string
          kind: Database["public"]["Enums"]["relation_kind"]
          source_node_id: string
          target_node_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          debate_id: string
          id?: string
          kind: Database["public"]["Enums"]["relation_kind"]
          source_node_id: string
          target_node_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          debate_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["relation_kind"]
          source_node_id?: string
          target_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relations_debate_id_fkey"
            columns: ["debate_id"]
            isOneToOne: false
            referencedRelation: "debates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relations_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relations_target_node_id_fkey"
            columns: ["target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_debate_with_root: {
        Args: { p_root_body?: string; p_root_title: string; p_title: string }
        Returns: string
      }
      patch_node: {
        Args: {
          p_metadata_patch?: Json
          p_node_id: string
          p_position_x?: number
          p_position_y?: number
        }
        Returns: {
          author_id: string
          created_at: string
          debate_id: string
          id: string
          kind: Database["public"]["Enums"]["node_kind"]
          metadata: Json
          position_x: number
          position_y: number
        }[]
        SetofOptions: {
          from: "*"
          to: "nodes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      set_debate_root: {
        Args: { p_debate_id: string; p_node_id: string }
        Returns: {
          created_at: string
          id: string
          owner_id: string
          root_node_id: string | null
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "debates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      username_available: { Args: { check_username: string }; Returns: boolean }
    }
    Enums: {
      connective_op: "and" | "or"
      exchange_status: "pending" | "accepted" | "declined"
      node_kind: "statement" | "connective"
      relation_kind: "supports" | "link" | "rephrases" | "rebuts"
      statement_type:
        | "claim"
        | "source"
        | "data"
        | "warrant"
        | "backing"
        | "rebuttal"
      turn_actor: "challenger" | "advocate"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      connective_op: ["and", "or"],
      exchange_status: ["pending", "accepted", "declined"],
      node_kind: ["statement", "connective"],
      relation_kind: ["supports", "link", "rephrases", "rebuts"],
      statement_type: [
        "claim",
        "source",
        "data",
        "warrant",
        "backing",
        "rebuttal",
      ],
      turn_actor: ["challenger", "advocate"],
    },
  },
} as const

