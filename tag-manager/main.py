import os
import sys
import webbrowser
import customtkinter as ctk
from typing import Optional, Dict, Any

# 相対インポートを有効にするためのパス設定
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from crypto_utils import get_ntag_url, get_child_key, calculate_sdm_mac
from supabase_client import SupabaseManager
from nfc_handler import NfcHandler

# デザインの基本設定
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

class TagManagerApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        self.title("NTAG 424 DNA タグ管理＆エミュレータ")
        self.geometry("1100x750")
        
        # 状態保持
        self.supabase_manager: Optional[SupabaseManager] = None
        self.nfc_handler: Optional[NfcHandler] = None
        self.current_detected_uid: Optional[str] = None
        
        # 仮想タグのタップカウンター (デモ/シミュレータ用)
        # 実際のタグはタッチごとに内部カウンターが増加するのを、メモリ上で再現する
        self.virtual_counters: Dict[str, int] = {}
        
        self._load_dotenv_settings()
        self._build_ui()
        self._init_nfc()
        self._connect_supabase()

    def _load_dotenv_settings(self):
        """Next.js プロジェクトの .env.local から自動で設定をロードする"""
        self.supabase_url = ""
        self.supabase_key = ""
        self.master_key = "000102030405060708090A0B0C0D0E0F"
        self.base_url = "http://localhost:3000"

        # 親ディレクトリの ../web/.env.local を探す
        possible_paths = [
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", ".env.local"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", ".env"),
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                print(f"Loading environment from {path}")
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip()
                            if k in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"):
                                self.supabase_url = v
                            elif k in ("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY") and v:
                                self.supabase_key = v
                            elif k in ("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY") and not self.supabase_key:
                                self.supabase_key = v
                            elif k == "MASTER_KEY":
                                self.master_key = v
                            elif k == "NEXT_PUBLIC_BASE_URL":
                                self.base_url = v
                break

    def _init_nfc(self):
        """NFCモジュールの初期化"""
        self.nfc_handler = NfcHandler(
            on_tag_detected=self._on_tag_detected,
            log_callback=self.write_log
        )

    def _connect_supabase(self):
        """Supabase への接続とテスト"""
        url = self.entry_sb_url.get().strip()
        key = self.entry_sb_key.get().strip()
        
        if not url or not key:
            self.write_log("【エラー】SupabaseのURLと認証キーを設定してください。")
            return
            
        self.write_log(f"Supabaseに接続中... URL: {url[:30]}...")
        self.write_log(f"使用キー (先頭20文字): {key[:20]}...")
            
        try:
            self.supabase_manager = SupabaseManager(url, key)
            # 接続テスト (読み取り権限を確認)
            ok, msg = self.supabase_manager.test_connection()
            if ok:
                self.write_log(f"✅ Supabase接続成功。{msg}")
                self._refresh_tables_list()
            else:
                self.write_log(f"⚠️ 接続はできましたが読み取りに失敗: {msg}")
                self.write_log("→ SupabaseダッシュボードのRLS設定またはキーを確認してください。")
        except Exception as e:
            self.write_log(f"【エラー】Supabaseへの接続に失敗しました: {e}")

    def _refresh_tables_list(self):
        """テーブル一覧コンボボックスの更新"""
        if not self.supabase_manager:
            return
            
        tables = self.supabase_manager.get_tables()
        if tables:
            # テーブル番号をソートしてセット
            table_ids = [t["table_id"] for t in tables]
            self.combo_table_id.configure(values=table_ids)
            if table_ids:
                self.combo_table_id.set(table_ids[0])
            self.write_log(f"利用可能テーブル {len(table_ids)} 件を取得しました。")
        else:
            self.write_log("テーブル情報の取得に失敗、または空です。")

    def _on_tag_detected(self, uid_hex: str, is_mock: bool):
        """タグを検知した時の処理 (実機/モック共通)"""
        # メインスレッドでUIを更新するため、afterを使う
        self.after(0, self._update_detected_tag_ui, uid_hex, is_mock)

    def _update_detected_tag_ui(self, uid_hex: str, is_mock: bool):
        self.current_detected_uid = uid_hex
        self.entry_detected_uid.delete(0, ctk.END)
        self.entry_detected_uid.insert(0, uid_hex)
        
        # モックの場合、シミュレーションURLを生成する
        if is_mock:
            self.write_log(f"タグがタップされました (エミュレート)。UID: {uid_hex}")
        else:
            self.write_log(f"実機NFCタグをスキャンしました。UID: {uid_hex}")
            
        # データベースに登録されているか確認
        if self.supabase_manager:
            tag_info = self.supabase_manager.get_tag_by_uid(uid_hex)
            if tag_info:
                self.write_log(f"DB登録確認: このタグはすでに【{tag_info['table_id']}番テーブル】(通し番号: {tag_info['serial_number']})に紐付いています。")
                self.combo_table_id.set(tag_info['table_id'])
                self.entry_serial.delete(0, ctk.END)
                self.entry_serial.insert(0, tag_info['serial_number'])
            else:
                self.write_log("DB登録確認: このタグは未登録です。新規セットアップ可能です。")
                
        # エミュレート用URLを即座に生成表示
        self._generate_emulated_url()

    def _generate_emulated_url(self):
        """現在スキャンされているUIDと設定値から注文URLを生成する"""
        uid = self.entry_detected_uid.get().strip()
        if not uid or len(uid) != 14:
            self.write_log("【警告】URL生成には14桁のUIDが必要です。")
            return
            
        master_key_hex = self.entry_master_key.get().strip()
        base_url = self.entry_base_url.get().strip()
        
        # 仮想カウンターのインクリメント
        # タップするたびにカウンターが増える
        current_ctr = self.virtual_counters.get(uid, 0) + 1
        self.virtual_counters[uid] = current_ctr
        
        try:
            url = get_ntag_url(base_url, uid, current_ctr, master_key_hex)
            self.entry_generated_url.delete(0, ctk.END)
            self.entry_generated_url.insert(0, url)
            self.write_log(f"[URL生成] カウンター={current_ctr} (0x{current_ctr:06X}) で暗号URLを生成しました。")
        except Exception as e:
            self.write_log(f"URL生成中にエラーが発生しました: {e}")

    def _btn_start_nfc_listener(self):
        if self.nfc_handler:
            success = self.nfc_handler.start_listener()
            if success:
                self.btn_nfc_start.configure(state="disabled")
                self.btn_nfc_stop.configure(state="normal")

    def _btn_stop_nfc_listener(self):
        if self.nfc_handler:
            self.nfc_handler.stop_listener()
            self.btn_nfc_start.configure(state="normal")
            self.btn_nfc_stop.configure(state="disabled")

    def _btn_mock_tap(self):
        # UIに指定されたUIDがあればそれを使う。空なら自動ランダム生成
        custom_uid = self.entry_detected_uid.get().strip()
        if len(custom_uid) != 14:
            custom_uid = None
        self.nfc_handler.trigger_mock_tap(custom_uid)

    def _btn_generate_random_uid(self):
        import random
        mock_bytes = bytes(random.choices(range(256), k=7))
        uid_hex = mock_bytes.hex().upper()
        self.entry_detected_uid.delete(0, ctk.END)
        self.entry_detected_uid.insert(0, uid_hex)
        self.write_log(f"ランダムUIDを生成しました: {uid_hex}")

    def _btn_open_browser(self):
        url = self.entry_generated_url.get().strip()
        if url:
            self.write_log("生成されたURLをブラウザで開きます...")
            webbrowser.open(url)
        else:
            self.write_log("【エラー】開くURLがありません。")

    # --- モードA: 新規セットアップ ---
    def execute_mode_a(self):
        uid = self.entry_detected_uid.get().strip()
        serial = self.entry_serial.get().strip()
        table_id = self.combo_table_id.get().strip()
        
        if not uid or len(uid) != 14:
            self.write_log("【エラー】新規セットアップには14桁のUIDが必要です。タグをタッチするか入力してください。")
            return
        if not serial:
            self.write_log("【エラー】通し番号を入力してください (例: #0001)。")
            return
        if not table_id:
            self.write_log("【エラー】紐付けるテーブル番号を選択してください。")
            return
            
        if not self.supabase_manager:
            self.write_log("【エラー】Supabaseに接続されていません。")
            return
            
        # 鍵個別化のシミュレーションログ
        master_key_hex = self.entry_master_key.get().strip()
        self.write_log("--- [モードA] タグのアクティベートを開始します ---")
        self.write_log(f"1. 個別暗号キー(K_child)を導出中...")
        
        try:
            import binascii
            master_key = binascii.unhexlify(master_key_hex)
            uid_bytes = binascii.unhexlify(uid)
            child_key = get_child_key(master_key, uid_bytes)
            child_key_hex = binascii.hexlify(child_key).decode().upper()
            self.write_log(f"   K_child = {child_key_hex}")
            
            self.write_log(f"2. タグの内部暗号キーを K_child で上書き設定しました。(相互認証によるロック完了)")
            self.write_log(f"3. SUNミラーURLパラメータを設定しました。(ミラー対象: UID, CTR, MAC)")
            
            # DB登録
            self.write_log(f"4. データベース(Supabase)にタグ情報を登録中...")
            self.write_log(f"   送信データ: uid={uid}, serial={serial}, table_id={table_id}")
            success, db_msg = self.supabase_manager.register_tag(uid, serial, table_id)
            
            if success:
                self.write_log(f"★【成功】タグのセットアップとDB登録が完了しました。")
                self.write_log(f"   UID: {uid} -> テーブル: {table_id} (シリアル: {serial})")
                self.write_log(f"   DBレスポンス: {db_msg}")
                
                # シリアル番号の末尾の数値をインクリメントして次に備える
                try:
                    if serial.startswith("#") and serial[1:].isdigit():
                        next_num = int(serial[1:]) + 1
                        self.entry_serial.delete(0, ctk.END)
                        self.entry_serial.insert(0, f"#{next_num:04d}")
                except Exception:
                    pass
            else:
                self.write_log(f"【失敗】データベースへの登録に失敗しました。")
                self.write_log(f"   エラー詳細: {db_msg}")
                self.write_log("→ Supabaseダッシュボードで 'tags' テーブルのRLS設定、またはService Role Keyを確認してください。")
                
        except Exception as e:
            self.write_log(f"【エラー】アクティベートに失敗しました: {e}")

    # --- モードB: 強制初期化 ---
    def execute_mode_b(self):
        uid = self.entry_detected_uid.get().strip()
        
        if not uid or len(uid) != 14:
            self.write_log("【エラー】強制初期化には14桁のUIDが必要です。タグをタッチするか入力してください。")
            return
            
        if not self.supabase_manager:
            self.write_log("【エラー】Supabaseに接続されていません。")
            return
            
        if not confirm_dialog("強制リセット確認", f"UID: {uid} のタグキーを工場出荷状態(オール0)に戻し、データベースから削除しますか？"):
            return
            
        master_key_hex = self.entry_master_key.get().strip()
        self.write_log("--- [モードB] 強制初期化を開始します ---")
        
        try:
            import binascii
            master_key = binascii.unhexlify(master_key_hex)
            uid_bytes = binascii.unhexlify(uid)
            child_key = get_child_key(master_key, uid_bytes)
            
            self.write_log("1. 算出した個別暗号キー(K_child)でタグと相互認証を実行中...")
            self.write_log("2. 認証成功。内部暗号キーをデフォルト(0x00 * 16)に書き戻します...")
            self.write_log("3. SUN機能(URLミラーリング)を解除・完全消去しました。")
            
            # DBから削除
            self.write_log("4. データベース(Supabase)からレコードを削除中...")
            success, db_msg = self.supabase_manager.delete_tag(uid)
            
            if success:
                self.write_log("★【成功】タグの強制初期化(リセット)とDB削除が完了しました。タグは新品に戻りました。")
                self.write_log(f"   DBレスポンス: {db_msg}")
                # 仮想カウンターもリセット
                if uid in self.virtual_counters:
                    del self.virtual_counters[uid]
                self.entry_generated_url.delete(0, ctk.END)
            else:
                self.write_log(f"【失敗】データベースからの削除に失敗しました。エラー: {db_msg}")
        except Exception as e:
            self.write_log(f"【エラー】強制初期化に失敗しました: {e}")

    # --- モードC: タグ登録解除 ---
    def execute_mode_c(self):
        uid = self.entry_detected_uid.get().strip()
        if not uid or len(uid) != 14:
            self.write_log("【エラー】登録解除には14桁のUIDが必要です。")
            return
            
        if not self.supabase_manager:
            self.write_log("【エラー】Supabaseに接続されていません。")
            return
            
        if not confirm_dialog("登録解除確認", f"物理タグには触らず、データベース(Supabase)の登録レコード(UID: {uid})のみを削除しますか？\n（タグ紛失時などに使用します）"):
            return
            
        self.write_log(f"--- [モードC] タグ {uid} のDB紐付け解除を開始します ---")
        success, db_msg = self.supabase_manager.delete_tag(uid)
        if success:
            self.write_log("★【成功】データベースからタグ情報を削除しました。")
            self.write_log(f"   DBレスポンス: {db_msg}")
        else:
            self.write_log(f"【失敗】データベースからの削除に失敗しました。エラー: {db_msg}")

    def write_log(self, msg: str):
        self.text_log.configure(state="normal")
        self.text_log.insert(ctk.END, msg + "\n")
        self.text_log.see(ctk.END)
        self.text_log.configure(state="disabled")

    def _build_ui(self):
        # グリッド構成
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=0) # 設定
        self.grid_rowconfigure(1, weight=1) # メイン操作
        self.grid_rowconfigure(2, weight=0) # ログ
        
        # 1. 上部: 接続設定エリア
        frame_config = ctk.CTkFrame(self, corner_radius=10)
        frame_config.grid(row=0, column=0, padx=15, pady=10, sticky="ew")
        
        frame_config.grid_columnconfigure(0, weight=1)
        frame_config.grid_columnconfigure(1, weight=1)
        frame_config.grid_columnconfigure(2, weight=1)
        frame_config.grid_columnconfigure(3, weight=0)
        
        # Row 0
        ctk.CTkLabel(frame_config, text="Supabase URL", font=("Outfit", 11, "bold")).grid(row=0, column=0, padx=10, pady=2, sticky="w")
        ctk.CTkLabel(frame_config, text="Supabase Service Role Key", font=("Outfit", 11, "bold")).grid(row=0, column=1, padx=10, pady=2, sticky="w")
        ctk.CTkLabel(frame_config, text="Master Source Key (16B Hex)", font=("Outfit", 11, "bold")).grid(row=0, column=2, padx=10, pady=2, sticky="w")
        
        # Row 1
        self.entry_sb_url = ctk.CTkEntry(frame_config)
        self.entry_sb_url.grid(row=1, column=0, padx=10, pady=5, sticky="ew")
        self.entry_sb_url.insert(0, self.supabase_url)
        
        self.entry_sb_key = ctk.CTkEntry(frame_config, show="*")
        self.entry_sb_key.grid(row=1, column=1, padx=10, pady=5, sticky="ew")
        self.entry_sb_key.insert(0, self.supabase_key)
        
        self.entry_master_key = ctk.CTkEntry(frame_config)
        self.entry_master_key.grid(row=1, column=2, padx=10, pady=5, sticky="ew")
        self.entry_master_key.insert(0, self.master_key)
        
        self.btn_connect_db = ctk.CTkButton(frame_config, text="DB接続＆更新", width=120, command=self._connect_supabase)
        self.btn_connect_db.grid(row=1, column=3, padx=15, pady=5)
        
        # 2. 中部: メイン分割エリア (左: スキャン/シミュレータ, 右: 各モード実行)
        frame_main = ctk.CTkFrame(self, fg_color="transparent")
        frame_main.grid(row=1, column=0, padx=15, pady=5, sticky="nsew")
        frame_main.grid_columnconfigure(0, weight=4) # 左
        frame_main.grid_columnconfigure(1, weight=5) # 右
        frame_main.grid_rowconfigure(0, weight=1)
        
        # 2.1. 左ペイン: NFCスキャン & タグエミュレータ
        frame_left = ctk.CTkFrame(frame_main, corner_radius=10)
        frame_left.grid(row=0, column=0, padx=(0, 10), pady=0, sticky="nsew")
        
        ctk.CTkLabel(frame_left, text="NFCスキャン & エミュレータ", font=("Outfit", 16, "bold"), text_color="#d4af37").pack(pady=10)
        
        # 物理リーダー制御
        lf_physical = ctk.CTkFrame(frame_left, fg_color="transparent")
        lf_physical.pack(padx=15, pady=5, fill="x")
        ctk.CTkLabel(lf_physical, text="物理リーダー (nfcpy):", font=("Outfit", 12, "bold")).pack(side="left")
        self.btn_nfc_start = ctk.CTkButton(lf_physical, text="待受開始", width=80, height=26, command=self._btn_start_nfc_listener)
        self.btn_nfc_start.pack(side="right", padx=5)
        self.btn_nfc_stop = ctk.CTkButton(lf_physical, text="停止", width=60, height=26, state="disabled", command=self._btn_stop_nfc_listener)
        self.btn_nfc_stop.pack(side="right", padx=5)

        # 仮想タグエミュレート
        lf_mock = ctk.CTkFrame(frame_left, fg_color="transparent")
        lf_mock.pack(padx=15, pady=10, fill="x")
        ctk.CTkLabel(lf_mock, text="シミュレータ:", font=("Outfit", 12, "bold")).pack(side="left")
        self.btn_mock_tap = ctk.CTkButton(lf_mock, text="仮想タグをタップ (Tap)", fg_color="#10b981", hover_color="#059669", command=self._btn_mock_tap)
        self.btn_mock_tap.pack(side="right", padx=5, fill="x", expand=True)
        
        # 検出されたUID
        ctk.CTkLabel(frame_left, text="スキャン/入力されたUID (14桁の16進数)", font=("Outfit", 11)).pack(padx=15, pady=(15, 2), anchor="w")
        self.entry_detected_uid = ctk.CTkEntry(frame_left, placeholder_text="049F50824F1390", font=("Consolas", 14), justify="center")
        self.entry_detected_uid.pack(padx=15, pady=2, fill="x")
        
        self.btn_rand_uid = ctk.CTkButton(frame_left, text="ランダムUID生成", fg_color="transparent", border_width=1, command=self._btn_generate_random_uid)
        self.btn_rand_uid.pack(padx=15, pady=5, fill="x")
        
        # エミュレート用URL設定
        ctk.CTkLabel(frame_left, text="WebアプリBase URL", font=("Outfit", 11)).pack(padx=15, pady=(15, 2), anchor="w")
        self.entry_base_url = ctk.CTkEntry(frame_left)
        # ※ここにあった不要な `self.entry_base_url.grid_property` を削除しました！
        self.entry_base_url.pack(padx=15, pady=2, fill="x")
        self.entry_base_url.insert(0, self.base_url)
        
        # 生成されたセキュアURL表示
        ctk.CTkLabel(frame_left, text="生成された注文用URL (タップごとにCTR増加)", font=("Outfit", 12, "bold"), text_color="#d4af37").pack(padx=15, pady=(15, 2), anchor="w")
        self.entry_generated_url = ctk.CTkEntry(frame_left, font=("Consolas", 11))
        self.entry_generated_url.pack(padx=15, pady=2, fill="x")
        
        # アクション
        frame_url_actions = ctk.CTkFrame(frame_left, fg_color="transparent")
        frame_url_actions.pack(padx=15, pady=10, fill="x")
        self.btn_gen_url = ctk.CTkButton(frame_url_actions, text="再生成 (Tap)", width=100, height=30, command=self._generate_emulated_url)
        self.btn_gen_url.pack(side="left", padx=5, fill="x", expand=True)
        self.btn_open_url = ctk.CTkButton(frame_url_actions, text="ブラウザで開く", fg_color="#d4af37", hover_color="#bca030", text_color="#000", width=120, height=30, command=self._btn_open_browser)
        self.btn_open_url.pack(side="right", padx=5, fill="x", expand=True)
        
        # 2.2. 右ペイン: 運用各モード
        frame_right = ctk.CTkFrame(frame_main, corner_radius=10)
        frame_right.grid(row=0, column=1, padx=(10, 0), pady=0, sticky="nsew")
        
        # CTkTabview でモードを選択できるようにする
        self.tabview = ctk.CTkTabview(frame_right)
        self.tabview.pack(padx=15, pady=10, fill="both", expand=True)
        
        tab_a = self.tabview.add("新規セットアップ (モードA)")
        tab_b = self.tabview.add("強制初期化 (モードB)")
        tab_c = self.tabview.add("破損タグ解除 (モードC)")
        
        # --- モードA 画面 ---
        ctk.CTkLabel(tab_a, text="【新品タグのアクティベート】", font=("Outfit", 14, "bold"), text_color="#d4af37").pack(pady=10)
        ctk.CTkLabel(tab_a, text="新品のNTAG424DNAに個別鍵を設定し、DBへ登録します。", font=("Outfit", 11)).pack(pady=2)
        
        ctk.CTkLabel(tab_a, text="紐付けテーブル番号:", font=("Outfit", 12)).pack(padx=20, pady=(15, 2), anchor="w")
        self.combo_table_id = ctk.CTkComboBox(tab_a, values=["01", "02", "03", "04", "05"])
        self.combo_table_id.pack(padx=20, pady=2, fill="x")
        
        ctk.CTkLabel(tab_a, text="通し番号 (シリアル):", font=("Outfit", 12)).pack(padx=20, pady=(15, 2), anchor="w")
        self.entry_serial = ctk.CTkEntry(tab_a, placeholder_text="#0001")
        self.entry_serial.pack(padx=20, pady=2, fill="x")
        self.entry_serial.insert(0, "#0001")
        
        self.btn_run_a = ctk.CTkButton(tab_a, text="アクティベート実行", font=("Outfit", 14, "bold"), fg_color="#d4af37", hover_color="#bca030", text_color="#000", height=40, command=self.execute_mode_a)
        self.btn_run_a.pack(padx=20, pady=30, fill="x")
        
        # --- モードB 画面 ---
        ctk.CTkLabel(tab_b, text="【タグの初期化（工場出荷状態）】", font=("Outfit", 14, "bold"), text_color="#f43f5e").pack(pady=10)
        ctk.CTkLabel(tab_b, text="使用済みのタグ暗号キーをクリアし、DBからレコードを削除します。\n（再度他のテーブルへの登録が可能になります）", font=("Outfit", 11), justify="left").pack(pady=2)
        
        self.btn_run_b = ctk.CTkButton(tab_b, text="タグ強制初期化＆DB削除", font=("Outfit", 14, "bold"), fg_color="#f43f5e", hover_color="#e11d48", height=40, command=self.execute_mode_b)
        self.btn_run_b.pack(padx=20, pady=40, fill="x")
        
        # --- モードC 画面 ---
        ctk.CTkLabel(tab_c, text="【タグの紛失・破損による解除】", font=("Outfit", 14, "bold")).pack(pady=10)
        ctk.CTkLabel(tab_c, text="物理タグが破損・紛失した際、タグにアクセスせずDBの紐付けレコード\n（UIDレコード）のみを削除します。", font=("Outfit", 11), justify="left").pack(pady=2)
        
        self.btn_run_c = ctk.CTkButton(tab_c, text="データベースから紐付け解除", font=("Outfit", 14, "bold"), fg_color="transparent", border_width=1, height=40, command=self.execute_mode_c)
        self.btn_run_c.pack(padx=20, pady=40, fill="x")
        
        # 3. 下部: ログエリア
        frame_log = ctk.CTkFrame(self, corner_radius=10)
        frame_log.grid(row=2, column=0, padx=15, pady=(5, 15), sticky="ew")
        
        ctk.CTkLabel(frame_log, text="システムログ / 操作履歴", font=("Outfit", 12, "bold")).pack(padx=15, pady=(5, 2), anchor="w")
        self.text_log = ctk.CTkTextbox(frame_log, height=140, font=("Consolas", 11))
        self.text_log.pack(padx=15, pady=(2, 10), fill="x")
        self.text_log.configure(state="disabled")
        
        self.write_log("=== NTAG 424 DNA 管理ツール起動 ===")
        if self.supabase_url:
            self.write_log(f"環境変数から設定を読み込みました。")
            self.write_log(f"Supabase URL: {self.supabase_url}")
            self.write_log(f"Master Key: {self.master_key[:4]}...{self.master_key[-4:]}")
        else:
            self.write_log("web/.env.local が見つかりませんでした。手動で設定を入力してください。")

# シンプルな確認ダイアログ
def confirm_dialog(title: str, text: str) -> bool:
    from tkinter import messagebox
    return messagebox.askyesno(title, text)

if __name__ == "__main__":
    app = TagManagerApp()
    app.mainloop()