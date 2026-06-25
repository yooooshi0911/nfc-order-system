export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type AppDatabase = {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string;
          table_id: string;
          items: Json;
          status: string;
          created_at: string;
        };
        Insert: {
          table_id: string;
          items: Json;
          status: string;
        };
        Update: {
          status?: string;
        };
        Relationships: [];
      };
      tables: {
        Row: {
          table_id: string;
          status: string;
          qr_token: string | null;
          updated_at: string;
        };
        Insert: {
          table_id: string;
          status?: string;
          qr_token?: string | null;
          updated_at?: string;
        };
        Update: {
          status?: string;
          qr_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          uid: string;
          table_id: string | null;
          invalidated_ctr: number;
          current_max_ctr: number;
        };
        Insert: {
          uid: string;
          serial_number: string;
          table_id?: string | null;
          invalidated_ctr?: number;
          current_max_ctr?: number;
        };
        Update: {
          serial_number?: string;
          table_id?: string | null;
          invalidated_ctr?: number;
          current_max_ctr?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      checkout_table: {
        Args: { p_table_id: string };
        Returns: void;
      };
    };
  };
};
