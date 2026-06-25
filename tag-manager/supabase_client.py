import os
from typing import List, Dict, Any, Optional, Tuple
from supabase import create_client, Client

class SupabaseManager:
    def __init__(self, url: str, key: str):
        self.url = url
        self.key = key
        self.client: Client = create_client(url, key)

    def test_connection(self) -> Tuple[bool, str]:
        """DB接続と読み書き権限をテストする"""
        try:
            # 読み取りテスト
            response = self.client.table("tags").select("uid").limit(1).execute()
            print(f"[DB Test] Read test OK. Data: {response.data}")
            return True, "接続OK・読み取りOK"
        except Exception as e:
            err_msg = str(e)
            print(f"[DB Test] Connection/read error: {e}")
            return False, f"接続エラー: {err_msg}"

    def get_tables(self) -> List[Dict[str, Any]]:
        """テーブル一覧を取得する"""
        try:
            response = self.client.table("tables").select("*").order("table_id").execute()
            return response.data or []
        except Exception as e:
            print(f"Error fetching tables: {e}")
            return []

    def get_registered_tags(self) -> List[Dict[str, Any]]:
        """登録済みタグ一覧を取得する"""
        try:
            response = self.client.table("tags").select("*").order("serial_number").execute()
            return response.data or []
        except Exception as e:
            print(f"Error fetching tags: {e}")
            return []

    def get_tag_by_uid(self, uid: str) -> Optional[Dict[str, Any]]:
        """UIDからタグ情報を取得する"""
        try:
            response = self.client.table("tags").select("*").eq("uid", uid.upper()).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            print(f"Error fetching tag by uid: {e}")
            return None

    def register_tag(self, uid: str, serial_number: str, table_id: str) -> Tuple[bool, str]:
        """NFCタグをデータベースに登録する。(成功フラグ, メッセージ) を返す"""
        try:
            data = {
                "uid": uid.upper(),
                "serial_number": serial_number,
                "table_id": table_id if table_id and table_id != "none" else None,
                "invalidated_ctr": 0,
                "current_max_ctr": 0
            }
            print(f"[DB] Upserting tag: {data}")
            response = self.client.table("tags").upsert(data).execute()
            print(f"[DB] Upsert response: {response}")
            if response.data:
                return True, f"登録成功: {response.data}"
            else:
                # dataが空でもエラーが無ければ成功とみなす
                return True, "登録完了"
        except Exception as e:
            err_msg = str(e)
            print(f"Error registering tag: {e}")
            return False, f"DBエラー: {err_msg}"

    def delete_tag(self, uid: str) -> Tuple[bool, str]:
        """NFCタグの紐付けを解除(データベースから削除)する。(成功フラグ, メッセージ) を返す"""
        try:
            response = self.client.table("tags").delete().eq("uid", uid.upper()).execute()
            print(f"[DB] Delete response: {response}")
            return True, "削除完了"
        except Exception as e:
            err_msg = str(e)
            print(f"Error deleting tag: {e}")
            return False, f"DBエラー: {err_msg}"
            
    def get_tag_by_table(self, table_id: str) -> Optional[Dict[str, Any]]:
        """テーブルIDから紐付いているタグ情報を取得する"""
        try:
            response = self.client.table("tags").select("*").eq("table_id", table_id).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            print(f"Error fetching tag by table_id: {e}")
            return None
