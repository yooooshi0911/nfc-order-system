import os
import sys
import webbrowser
import threading
import time
import binascii
from typing import Optional, Dict, Any, List

import customtkinter as ctk
from tkinter import ttk, messagebox

# パス設定
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from crypto_utils import get_ntag_url, get_child_key, calculate_sdm_mac
from supabase_client import SupabaseManager

# smartcard (pyscard) ロード確認
try:
    from smartcard.System import readers
    from smartcard.CardConnection import CardConnection
    from smartcard.Exceptions import CardConnectionException, NoCardException
    HAS_PYSCARD = True
except ImportError:
    HAS_PYSCARD = False

# pylibsdm ロード確認
try:
    from pylibsdm.tag.ntag424dna.tag import NTAG424DNA
    from pylibsdm.tag.ntag424dna.structs import (
        FileSettings, FileOption, SDMOptions, SDMAccessRights, AccessRights,
        CommMode, AccessCondition
    )
    HAS_PYLIBSDM = True
except ImportError:
    HAS_PYLIBSDM = False

# デザイン設定
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")  # ベーステーマ

class PcscTagWrapper:
    """pylibsdm用 PC/SC APDU送受信ラッパー"""
    def __init__(self, connection):
        self.connection = connection

    def send_apdu(self, cla, ins, p1, p2, data=b"", mrl=256, check_status=False):
        apdu = [cla, ins, p1, p2]
        if data:
            apdu.append(len(data))
            apdu.extend(list(data))
        apdu.append(0x00)
        
        res_data, sw1, sw2 = self.connection.transmit(apdu)
        return bytes(res_data) + bytes([sw1, sw2])


class TagManagerApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        self.title("NTAG 424 DNA セキュアタグ管理システム (PC/SC対応)")
        self.geometry("1200x820")
        
        # 状態管理
        self.supabase_manager: Optional[SupabaseManager] = None
        self.pcsc_thread: Optional[threading.Thread] = None
        self.pcsc_running = False
        
        # 検知された実機情報
        self.physical_uid: Optional[str] = None
        self.physical_url: Optional[str] = None
        
        # 仮想エミュレータ用
        self.virtual_uid: Optional[str] = None
        self.virtual_counters: Dict[str, int] = {}
        
        # 設定のロード
        self._load_settings()
        
        # UI構築
        self._build_ui()
        
        # 初期接続
        self.after(500, self._connect_supabase)

    def _load_settings(self):
        self.supabase_url = ""
        self.supabase_key = ""
        self.master_key = "000102030405060708090A0B0C0D0E0F"
        self.base_url = "http://localhost:3000"

        # .env.local から自動読み込み
        possible_paths = [
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", ".env.local"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", ".env"),
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                print(f"Loading env from {path}")
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
                            elif k in ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY") and v:
                                self.supabase_key = v
                            elif k in ("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY") and not self.supabase_key:
                                self.supabase_key = v
                            elif k == "MASTER_KEY":
                                self.master_key = v
                            elif k == "NEXT_PUBLIC_BASE_URL":
                                self.base_url = v
                break

    def _connect_supabase(self):
        url = self.entry_sb_url.get().strip()
        key = self.entry_sb_key.get().strip()
        
        if not url or not key:
            self.write_log("【警告】Supabase の接続情報が未入力です。")
            self.lbl_db_status.configure(text="接続設定なし", text_color="#f43f5e")
            return
            
        self.write_log(f"Supabase に接続中...")
        try:
            self.supabase_manager = SupabaseManager(url, key)
            ok, msg = self.supabase_manager.test_connection()
            if ok:
                self.write_log(f"✅ Supabase接続成功！ ({msg})")
                self.lbl_db_status.configure(text="接続中 (正常)", text_color="#10b981")
                self._refresh_db_table_ids()
                self.refresh_tags_table()
            else:
                self.write_log(f"⚠️ Supabase接続エラー: {msg}")
                self.lbl_db_status.configure(text="接続エラー", text_color="#f43f5e")
        except Exception as e:
            self.write_log(f"❌ DB初期化に失敗しました: {e}")
            self.lbl_db_status.configure(text="接続失敗", text_color="#f43f5e")

    def _refresh_db_table_ids(self):
        if not self.supabase_manager:
            return
        tables = self.supabase_manager.get_tables()
        if tables:
            table_ids = [t["table_id"] for t in tables]
            self.combo_phys_table.configure(values=table_ids)
            if table_ids:
                self.combo_phys_table.set(table_ids[0])
            self.write_log(f"利用可能なテーブル情報 {len(table_ids)} 件を取得しました。")

    def write_log(self, msg: str):
        self.text_log.configure(state="normal")
        self.text_log.insert(ctk.END, f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        self.text_log.see(ctk.END)
        self.text_log.configure(state="disabled")

    # ==================== UI 構築 ====================
    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=0)  # 設定パネル
        self.grid_rowconfigure(1, weight=1)  # メインタブビュー
        self.grid_rowconfigure(2, weight=0)  # ログ

        # ---------------- 1. 設定パネル ----------------
        frame_config = ctk.CTkFrame(self, corner_radius=8)
        frame_config.grid(row=0, column=0, padx=15, pady=(15, 5), sticky="ew")
        frame_config.grid_columnconfigure((0, 1, 2), weight=1)
        frame_config.grid_columnconfigure(3, weight=0)
        
        # 行 0: ラベル
        ctk.CTkLabel(frame_config, text="Supabase URL", font=("Outfit", 11, "bold")).grid(row=0, column=0, padx=10, pady=(5, 0), sticky="w")
        ctk.CTkLabel(frame_config, text="Service Role Key", font=("Outfit", 11, "bold")).grid(row=0, column=1, padx=10, pady=(5, 0), sticky="w")
        ctk.CTkLabel(frame_config, text="Master Source Key (Hex)", font=("Outfit", 11, "bold")).grid(row=0, column=2, padx=10, pady=(5, 0), sticky="w")
        
        # 行 1: 入力欄
        self.entry_sb_url = ctk.CTkEntry(frame_config, height=28)
        self.entry_sb_url.grid(row=1, column=0, padx=10, pady=(2, 8), sticky="ew")
        self.entry_sb_url.insert(0, self.supabase_url)
        
        self.entry_sb_key = ctk.CTkEntry(frame_config, show="*", height=28)
        self.entry_sb_key.grid(row=1, column=1, padx=10, pady=(2, 8), sticky="ew")
        self.entry_sb_key.insert(0, self.supabase_key)
        
        self.entry_master_key = ctk.CTkEntry(frame_config, height=28)
        self.entry_master_key.grid(row=1, column=2, padx=10, pady=(2, 8), sticky="ew")
        self.entry_master_key.insert(0, self.master_key)
        
        # 右端: 接続ステータス & ボタン
        frame_db_btn = ctk.CTkFrame(frame_config, fg_color="transparent")
        frame_db_btn.grid(row=0, column=3, rowspan=2, padx=15, pady=5, sticky="nsew")
        
        self.lbl_db_status = ctk.CTkLabel(frame_db_btn, text="未接続", font=("Outfit", 10, "bold"), text_color="#d4af37")
        self.lbl_db_status.pack(pady=(2, 2))
        
        self.btn_db_conn = ctk.CTkButton(frame_db_btn, text="DB再接続", width=90, height=26, command=self._connect_supabase)
        self.btn_db_conn.pack()

        # ---------------- 2. メインタブビュー ----------------
        self.tabview = ctk.CTkTabview(self, corner_radius=10)
        self.tabview.grid(row=1, column=0, padx=15, pady=5, sticky="nsew")
        
        # タブの追加
        tab_phys = self.tabview.add("物理タグ (実機リーダー)")
        tab_virt = self.tabview.add("仮想タグ (エミュレーター)")
        tab_list = self.tabview.add("データベース登録一覧 (物理のみ)")
        
        self._build_physical_tab(tab_phys)
        self._build_virtual_tab(tab_virt)
        self._build_list_tab(tab_list)

        # ---------------- 3. ログエリア ----------------
        frame_log = ctk.CTkFrame(self, corner_radius=8)
        frame_log.grid(row=2, column=0, padx=15, pady=(5, 15), sticky="ew")
        
        ctk.CTkLabel(frame_log, text="📁 システム動作ログ", font=("Outfit", 11, "bold"), text_color="#888").pack(padx=12, pady=(5, 2), anchor="w")
        self.text_log = ctk.CTkTextbox(frame_log, height=130, font=("Consolas", 11), fg_color="#121212")
        self.text_log.pack(padx=12, pady=(2, 10), fill="x")
        self.text_log.configure(state="disabled")

    # ==================== 物理タグ（実機）タブのUIと処理 ====================
    def _build_physical_tab(self, tab):
        tab.grid_columnconfigure(0, weight=4) # 左側: 検知情報
        tab.grid_columnconfigure(1, weight=5) # 右側: 操作パネル
        tab.grid_rowconfigure(0, weight=1)

        # --- 左半分: 検知・スキャンエリア ---
        frame_scan = ctk.CTkFrame(tab, corner_radius=8)
        frame_scan.grid(row=0, column=0, padx=(0, 8), pady=10, sticky="nsew")
        
        ctk.CTkLabel(frame_scan, text="📡 物理リーダー制御 & スキャン", font=("Outfit", 15, "bold"), text_color="#d4af37").pack(pady=12)
        
        # リーダー接続情報 & 開始ボタン
        frame_ctrl = ctk.CTkFrame(frame_scan, fg_color="transparent")
        frame_ctrl.pack(fill="x", padx=15, pady=5)
        self.lbl_reader_info = ctk.CTkLabel(frame_ctrl, text="リーダー: 未接続", font=("Outfit", 12))
        self.lbl_reader_info.pack(side="left")
        
        self.btn_phys_start = ctk.CTkButton(frame_ctrl, text="待受開始 (PC/SC)", fg_color="#10b981", hover_color="#059669", width=120, height=28, command=self._start_pcsc_listener)
        self.btn_phys_start.pack(side="right", padx=5)
        
        self.btn_phys_stop = ctk.CTkButton(frame_ctrl, text="停止", fg_color="#f43f5e", hover_color="#e11d48", state="disabled", width=60, height=28, command=self._stop_pcsc_listener)
        self.btn_phys_stop.pack(side="right")

        # かざされたカードの情報カード
        frame_card = ctk.CTkFrame(frame_scan, fg_color="#1d1d1d", corner_radius=8, border_width=1, border_color="#333")
        frame_card.pack(fill="both", expand=True, padx=15, pady=15)
        
        ctk.CTkLabel(frame_card, text="--- 最新の検知したタグ ---", font=("Outfit", 11, "bold"), text_color="#888").pack(pady=8)
        
        # UID
        self.lbl_phys_uid = ctk.CTkLabel(frame_card, text="-- NO TAG DETECTED --", font=("Consolas", 18, "bold"), text_color="#888")
        self.lbl_phys_uid.pack(pady=10)
        
        # NDEF URL
        ctk.CTkLabel(frame_card, text="NDEF URL (埋め込みURL)", font=("Outfit", 11), text_color="#888").pack(anchor="w", padx=15)
        self.entry_phys_url = ctk.CTkEntry(frame_card, font=("Consolas", 11), fg_color="#121212")
        self.entry_phys_url.pack(fill="x", padx=15, pady=4)
        
        # 解析結果 & MAC検証
        self.lbl_phys_analysis = ctk.CTkLabel(frame_card, text="SUNステータス: 未解析", font=("Outfit", 12))
        self.lbl_phys_analysis.pack(pady=10)

        # --- 右半分: 実機操作パネル ---
        frame_ops = ctk.CTkFrame(tab, corner_radius=8)
        frame_ops.grid(row=0, column=1, padx=(8, 0), pady=10, sticky="nsew")
        
        # サブタブ: アクティベート / 初期化
        self.phys_ops_tab = ctk.CTkTabview(frame_ops)
        self.phys_ops_tab.pack(fill="both", expand=True, padx=10, pady=10)
        
        pop_act = self.phys_ops_tab.add("SUN機能の書き込み (アクティベート)")
        pop_reset = self.phys_ops_tab.add("工場出荷状態へリセット")
        
        # アクティベート画面
        ctk.CTkLabel(pop_act, text="カードにセキュア注文URLをプログラミングし、DBに登録します。", font=("Outfit", 11), justify="left").pack(anchor="w", padx=20, pady=10)
        
        ctk.CTkLabel(pop_act, text="紐付けテーブルID (DB連携):", font=("Outfit", 12, "bold")).pack(anchor="w", padx=20, pady=(15, 2))
        self.combo_phys_table = ctk.CTkComboBox(pop_act, values=["01", "02", "03"])
        self.combo_phys_table.pack(fill="x", padx=20, pady=2)
        
        ctk.CTkLabel(pop_act, text="通し番号 (シリアル番号):", font=("Outfit", 12, "bold")).pack(anchor="w", padx=20, pady=(15, 2))
        self.entry_phys_serial = ctk.CTkEntry(pop_act, placeholder_text="#0001")
        self.entry_phys_serial.pack(fill="x", padx=20, pady=2)
        self.entry_phys_serial.insert(0, "#0001")
        
        # キー設定モードの追加
        self.var_key_mode = ctk.StringVar(value="default")
        ctk.CTkLabel(pop_act, text="暗号キー (パスワード) 設定方式:", font=("Outfit", 12, "bold")).pack(anchor="w", padx=20, pady=(15, 2))
        
        frame_radio = ctk.CTkFrame(pop_act, fg_color="transparent")
        frame_radio.pack(fill="x", padx=20, pady=2)
        ctk.CTkRadioButton(frame_radio, text="工場出荷時 (00...00) [開発用]", variable=self.var_key_mode, value="default", font=("Outfit", 11)).pack(side="left", padx=(0, 10))
        ctk.CTkRadioButton(frame_radio, text="UIDベースの独自キー [本番用]", variable=self.var_key_mode, value="derived", font=("Outfit", 11)).pack(side="left")
        
        ctk.CTkLabel(pop_act, text="※書き込み完了後、指定されたキー方式でSUN機能が設定されます。", font=("Outfit", 10), text_color="#888").pack(anchor="w", padx=20, pady=(10, 0))
        
        self.btn_phys_write = ctk.CTkButton(pop_act, text="⚡ 実機へ書き込み ＆ DB登録 ⚡", font=("Outfit", 14, "bold"), fg_color="#d4af37", hover_color="#bca030", text_color="#000", height=42, command=self._execute_physical_activate)
        self.btn_phys_write.pack(fill="x", padx=20, pady=30)

        # リセット画面
        ctk.CTkLabel(pop_reset, text="【警告】タグの設定をクリアし、工場出荷状態に戻します。", font=("Outfit", 14, "bold"), text_color="#f43f5e").pack(pady=15)
        ctk.CTkLabel(pop_reset, text="・タグ内のSUN設定（ミラーURL）を完全に解除・削除します。\n・タグのアクセス権も完全にオープンな状態に戻ります。\n・同時に、データベース(Supabase)からこのタグのUIDレコードを削除します。", font=("Outfit", 11), justify="left").pack(padx=20, pady=10)
        
        self.btn_phys_reset = ctk.CTkButton(pop_reset, text="⚠️ タグをリセット ＆ DB削除 ⚠️", font=("Outfit", 14, "bold"), fg_color="#f43f5e", hover_color="#e11d48", height=42, command=self._execute_physical_reset)
        self.btn_phys_reset.pack(fill="x", padx=20, pady=40)

    def _start_pcsc_listener(self):
        if not HAS_PYSCARD:
            self.write_log("【エラー】pyscard がインポートできないため、実機リーダーは利用できません。")
            return
        
        if self.pcsc_running:
            return

        r_list = readers()
        if not r_list:
            self.write_log("【エラー】PC/SCリーダーが検出されませんでした。USB接続を確認してください。")
            return

        self.lbl_reader_info.configure(text=f"リーダー: {r_list[0]}")
        self.pcsc_running = True
        self.btn_phys_start.configure(state="disabled")
        self.btn_phys_stop.configure(state="normal")
        
        self.pcsc_thread = threading.Thread(target=self._pcsc_loop, args=(r_list[0],), daemon=True)
        self.pcsc_thread.start()
        self.write_log("実機リーダー監視スレッドを開始しました。(タグのタッチを待っています)")

    def _stop_pcsc_listener(self):
        self.pcsc_running = False
        self.btn_phys_start.configure(state="normal")
        self.btn_phys_stop.configure(state="disabled")
        self.lbl_reader_info.configure(text="リーダー: 停止中")
        self.write_log("実機リーダー監視を停止しました。")

    def _pcsc_loop(self, reader):
        last_uid = None
        while self.pcsc_running:
            try:
                conn = reader.createConnection()
                conn.connect()
            except Exception:
                # タグが乗っていない状態
                last_uid = None
                time.sleep(0.4)
                continue

            try:
                # 1. UID取得 (GET_DATA APDU)
                apdu = [0xFF, 0xCA, 0x00, 0x00, 0x00]
                data, sw1, sw2 = conn.transmit(apdu)
                if sw1 == 0x90 and sw2 == 0x00:
                    uid = bytes(data).hex().upper()
                else:
                    uid = None
                
                # 重複検知を防止（乗せたままの時は1回だけログする）
                if uid and uid != last_uid:
                    last_uid = uid
                    self.write_log(f"物理タグを検知しました！ UID: {uid}")
                    
                    # NDEF 読み取り
                    # NDEF App選択
                    conn.transmit([0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00])
                    # NDEF File選択
                    conn.transmit([0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04])
                    
                    # 長さ読み取り
                    data_len, sw1, sw2 = conn.transmit([0x00, 0xB0, 0x00, 0x00, 0x02])
                    url_str = ""
                    if sw1 == 0x90 and sw2 == 0x00:
                        nlen = (data_len[0] << 8) | data_len[1]
                        if nlen > 0:
                            data_body, sw1_b, sw2_b = conn.transmit([0x00, 0xB0, 0x00, 0x02, nlen])
                            if sw1_b == 0x90 and sw2_b == 0x00:
                                payload = bytes(data_body)
                                if len(payload) > 4 and payload[3] == 0x55: # 'U'
                                    prefix_id = payload[4]
                                    prefixes = {1: "http://www.", 2: "https://www.", 3: "http://", 4: "https://"}
                                    prefix = prefixes.get(prefix_id, "")
                                    url_str = prefix + payload[5:].decode('utf-8', errors='ignore')
                    
                    # UI側を安全に更新
                    self.after(0, self._on_physical_tag_detected, uid, url_str)
                    
            except Exception as e:
                err_str = str(e)
                # 一般的な切断エラーやスマートカード通信エラーは無視してログを綺麗に保つ
                if "Failed to transmit" not in err_str and "0x8010002F" not in err_str and "0x80100068" not in err_str:
                    self.write_log(f"スキャン中にエラー: {e}")
            finally:
                try:
                    conn.disconnect()
                except Exception:
                    pass
            
            time.sleep(0.8)

    def _on_physical_tag_detected(self, uid: str, url: str):
        self.physical_uid = uid
        self.physical_url = url
        
        self.lbl_phys_uid.configure(text=uid, text_color="#d4af37")
        self.entry_phys_url.delete(0, ctk.END)
        self.entry_phys_url.insert(0, url)
        
        # SUN検証
        if not url:
            self.lbl_phys_analysis.configure(text="SUNステータス: URL未設定 (空タグです)", text_color="#f43f5e")
            return
            
        # パラメータパース
        params = {}
        if '?' in url:
            query = url.split('?', 1)[1]
            for part in query.split('&'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    params[k.lower()] = v
                    
        uid_p = params.get('uid', '')
        ctr_p = params.get('ctr', '')
        mac_p = params.get('mac', '')
        
        if uid_p and ctr_p and mac_p:
            try:
                ctr_int = int(ctr_p, 16)
            except ValueError:
                ctr_int = 0
                
            # MAC検証
            try:
                # 1. SV
                sv = bytearray(16)
                sv[0:6] = [0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]
                sv[6:13] = bytes.fromhex(uid_p)
                sv[13:16] = ctr_int.to_bytes(3, byteorder='little')
                
                from Crypto.Hash import CMAC
                from Crypto.Cipher import AES
                
                def local_cmac(k, d):
                    c = CMAC.new(k, ciphermod=AES)
                    c.update(d)
                    return c.digest()
                
                def calc_mac(k_base):
                    k_ses = local_cmac(k_base, bytes(sv))
                    final_cmac = local_cmac(k_ses, b"")
                    return final_cmac[1::2].hex().upper() # NXP奇数バイトスライス
                
                # パターン1: 工場出荷キー (00..00)
                mac_default = calc_mac(b"\x00" * 16)
                
                # パターン2: 独自キー (Master Keyベース)
                master_key_bytes = bytes.fromhex(self.entry_master_key.get().strip())
                uid_bytes = bytes.fromhex(uid_p)
                child_key = get_child_key(master_key_bytes, uid_bytes)
                mac_derived = calc_mac(child_key)
                
                if mac_p.upper() == mac_default:
                    self.lbl_phys_analysis.configure(
                        text=f"SUNステータス: ✅ MAC検証成功 [開発キー] (CTR: {ctr_int})",
                        text_color="#10b981"
                    )
                    self.write_log(f"検証結果: タグのSUN MACは有効です。(開発キー一致) (CTR: {ctr_int})")
                elif mac_p.upper() == mac_derived:
                    self.lbl_phys_analysis.configure(
                        text=f"SUNステータス: ✅ MAC検証成功 [独自キー] (CTR: {ctr_int})",
                        text_color="#10b981"
                    )
                    self.write_log(f"検証結果: タグのSUN MACは有効です。(本番独自キー一致) (CTR: {ctr_int})")
                else:
                    self.lbl_phys_analysis.configure(
                        text="SUNステータス: ❌ MAC検証失敗 (不正な署名)",
                        text_color="#f43f5e"
                    )
                    self.write_log(f"検証結果: MAC不一致。タグ: {mac_p} / 期待値(開発): {mac_default} / 期待値(本番): {mac_derived}")
            except Exception as e:
                self.lbl_phys_analysis.configure(text=f"SUNステータス: 検証エラー ({e})", text_color="#f43f5e")
        else:
            self.lbl_phys_analysis.configure(text="SUNステータス: パラメータ不完全 (SUN設定なし)", text_color="#888")

    def _execute_physical_activate(self):
        """実機NTAGに対して、実際にSUN設定をプログラミングし、DBに登録する"""
        if not self.physical_uid:
            messagebox.showerror("エラー", "書き込む対象の物理タグがスキャンされていません。\nリーダーを起動し、タグをかざしてください。")
            return
            
        uid_hex = self.physical_uid
        table_id = self.combo_phys_table.get().strip()
        serial = self.entry_phys_serial.get().strip()
        
        if not table_id or not serial:
            messagebox.showerror("エラー", "テーブルIDとシリアル番号を入力してください。")
            return
            
        if not self.supabase_manager:
            messagebox.showerror("エラー", "データベースへの接続が完了していません。")
            return

        # NTAG 424 DNA へのプログラミングを試みる
        self.write_log(f"--- 物理タグへのSUNアクティベートを開始します (UID: {uid_hex}) ---")
        
        r_list = readers()
        if not r_list:
            messagebox.showerror("エラー", "書き込み用のカードリーダーが見つかりません。")
            return
            
        reader = r_list[0]
        try:
            conn = reader.createConnection()
            conn.connect()
        except Exception as e:
            messagebox.showerror("エラー", f"タグへの接続に失敗しました: {e}\nタグがリーダーの上にしっかりと乗っているか確認してください。")
            return
            
        try:
            # 1. URLテンプレート書き込み
            # 本番URLベース
            base_url = self.entry_base_url.get().strip() if hasattr(self, 'entry_base_url') else self.base_url
            url_template = f"{base_url}/auth?uid=00000000000000&ctr=000000&mac=0000000000000000"
            
            self.write_log(f"NDEFにURLテンプレートを書き込み中...")
            prefix_code = 0x03
            uri_text = url_template
            if url_template.startswith("http://"):
                prefix_code = 0x03
                uri_text = url_template[7:]
            elif url_template.startswith("https://"):
                prefix_code = 0x04
                uri_text = url_template[8:]
                
            uri_bytes = uri_text.encode('utf-8')
            payload = bytes([prefix_code]) + uri_bytes
            ndef_record = bytes([0xD1, 0x01, len(payload), 0x55]) + payload
            ndef_file_data = bytes([len(ndef_record) >> 8, len(ndef_record) & 0xFF]) + ndef_record
            
            # APDUで通常書き込み
            conn.transmit([0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00])
            conn.transmit([0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04])
            conn.transmit([0x00, 0xD6, 0x00, 0x00, 0x02, 0x00, 0x00]) # テンポラリ0長
            
            # 分割/一括UPDATE BINARY (通常サイズなので一括)
            conn.transmit([0x00, 0xD6, 0x00, 0x02, len(ndef_file_data)-2] + list(ndef_file_data[2:]))
            conn.transmit([0x00, 0xD6, 0x00, 0x00, 0x02, ndef_file_data[0], ndef_file_data[1]])
            
            self.write_log("URLテンプレート書き込み完了。")
            
            # オフセットの計算
            prefix_len = len("http://") if url_template.startswith("http://") else len("https://")
            text_without_prefix = url_template[prefix_len:]
            
            payload_start = 7
            uid_idx = text_without_prefix.find("uid=")
            ctr_idx = text_without_prefix.find("ctr=")
            mac_idx = text_without_prefix.find("mac=")
            
            uid_offset = payload_start + uid_idx + len("uid=")
            ctr_offset = payload_start + ctr_idx + len("ctr=")
            mac_offset = payload_start + mac_idx + len("mac=")
            
            # 2. SDM設定 (pylibsdm経由)
            self.write_log("pylibsdm を使って SUN(SDM) 設定変更を送信中...")
            wrapper = PcscTagWrapper(conn)
            ntag = NTAG424DNA(wrapper)
            
            # 工場出荷キー
            ntag.set_key(0, b"\x00" * 16)
            ntag.set_key(2, b"\x00" * 16)
            
            # 認証
            ntag.authenticate_ev2_first(0)
            
            # 設定構築
            file_settings = FileSettings(
                file_option=FileOption(sdm_enabled=True, comm_mode=CommMode.PLAIN),
                access_rights=AccessRights(
                    read=AccessCondition.FREE_ACCESS, write=AccessCondition.KEY_0,
                    read_write=AccessCondition.KEY_0, change=AccessCondition.KEY_0
                ),
                sdm_options=SDMOptions(
                    uid=True, read_ctr=True, read_ctr_limit=False,
                    enc_file_data=False, tt_status=False, ascii_encoding=True
                ),
                sdm_access_rights=SDMAccessRights(
                    meta_read=AccessCondition.FREE_ACCESS,
                    file_read=AccessCondition.KEY_0, # Key 0 (Master) で署名
                    ctr_ret=AccessCondition.KEY_0
                ),
                uid_offset=uid_offset,
                read_ctr_offset=ctr_offset,
                mac_offset=mac_offset,
                mac_input_offset=mac_offset
            )
            
            ntag.change_file_settings(2, file_settings)
            
            # キー設定の適用
            key_mode = self.var_key_mode.get()
            if key_mode == "derived":
                self.write_log("UIDベースの個別キー(Individual Key)を生成し、タグのMaster Keyを更新します...")
                master_key_bytes = bytes.fromhex(self.entry_master_key.get().strip())
                uid_bytes = bytes.fromhex(uid_hex)
                child_key = get_child_key(master_key_bytes, uid_bytes)
                
                # Key 0 (Master Key) を変更する
                # pylibsdm の change_key は、(key_nr, new_key, current_key_version)
                ntag.change_key(0, child_key)
                self.write_log(f"✅ 個別キーの設定が完了しました。")
            else:
                self.write_log("✅ 工場出荷キー(00..00)のままSUN機能を有効化しました。")
                
            self.write_log("✅ タグ側のSUN機能プログラミングに成功しました！")
            
            # 3. DBへ登録
            self.write_log("データベース (Supabase) にタグを登録中...")
            success, db_msg = self.supabase_manager.register_tag(uid_hex, serial, table_id)
            
            if success:
                self.write_log("★【成功】タグのアクティベート ＆ DB登録完了！")
                messagebox.showinfo("成功", f"タグ {uid_hex} のセットアップが完了しました！\nテーブル {table_id} に紐付けました。")
                
                # シリアルインクリメント
                try:
                    if serial.startswith("#") and serial[1:].isdigit():
                        next_num = int(serial[1:]) + 1
                        self.entry_phys_serial.delete(0, ctk.END)
                        self.entry_phys_serial.insert(0, f"#{next_num:04d}")
                except Exception:
                    pass
                
                self.refresh_tags_table()
            else:
                self.write_log(f"⚠️ DB登録失敗: {db_msg}")
                messagebox.showerror("DB登録エラー", f"タグへの書き込みは成功しましたが、DB登録に失敗しました:\n{db_msg}")
                
        except Exception as e:
            self.write_log(f"❌ 書き込みアクティベートエラー: {e}")
            messagebox.showerror("書き込みエラー", f"アクティベートに失敗しました: {e}\nタグが初期状態(デフォルトキー)か確認してください。")
        finally:
            conn.disconnect()

    def _execute_physical_reset(self):
        """実機NTAGの設定を工場出荷状態に戻し、DBから削除する"""
        if not self.physical_uid:
            messagebox.showerror("エラー", "リセット対象の物理タグがスキャンされていません。")
            return
            
        uid_hex = self.physical_uid
        if not messagebox.askyesno("強制リセットの確認", f"警告: タグ {uid_hex} を完全に初期化（工場出荷状態）に戻し、DBから削除してよろしいですか？\n（この操作は元に戻せません）"):
            return
            
        if not self.supabase_manager:
            messagebox.showerror("エラー", "データベースに接続されていません。")
            return

        self.write_log(f"--- 物理タグの初期化リセットを開始します (UID: {uid_hex}) ---")
        
        r_list = readers()
        if not r_list:
            return
        reader = r_list[0]
        try:
            conn = reader.createConnection()
            conn.connect()
        except Exception as e:
            messagebox.showerror("エラー", f"接続失敗: {e}")
            return
            
        try:
            # 1. 認証とSDM解除
            wrapper = PcscTagWrapper(conn)
            ntag = NTAG424DNA(wrapper)
            
            # 認証（工場出荷キーまたはUIDベース個別キー）
            try:
                ntag.set_key(0, b"\x00" * 16)
                ntag.authenticate_ev2_first(0)
            except Exception:
                # 失敗した場合は、UIDベースの個別キーを生成して再挑戦
                master_key_bytes = bytes.fromhex(self.entry_master_key.get().strip())
                uid_bytes = bytes.fromhex(uid_hex)
                child_key = get_child_key(master_key_bytes, uid_bytes)
                ntag.set_key(0, child_key)
                ntag.authenticate_ev2_first(0)
            
            # 工場出荷時の標準設定 (SDMなし、アクセスはFREE)
            file_settings = FileSettings(
                file_option=FileOption(sdm_enabled=False, comm_mode=CommMode.PLAIN),
                access_rights=AccessRights(
                    read=AccessCondition.FREE_ACCESS, write=AccessCondition.FREE_ACCESS,
                    read_write=AccessCondition.FREE_ACCESS, change=AccessCondition.KEY_0
                )
            )
            ntag.change_file_settings(2, file_settings)
            
            # マスターキーを工場出荷時(00..00)に戻す
            ntag.change_key(0, b"\x00" * 16)
            self.write_log("SDM機能を解除し、キーを工場出荷状態に戻しました。")
            
            # 2. NDEFクリア (データ長 = 0 で書き込み)
            conn.transmit([0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00])
            conn.transmit([0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04])
            conn.transmit([0x00, 0xD6, 0x00, 0x00, 0x02, 0x00, 0x00])
            self.write_log("NDEF URLレコードを消去しました。")
            
            # 3. DBからレコード削除
            success, db_msg = self.supabase_manager.delete_tag(uid_hex)
            if success:
                self.write_log("★【成功】タグのリセット ＆ DB紐付け削除完了！")
                messagebox.showinfo("成功", f"タグ {uid_hex} を正常に工場出荷リセットし、DBから削除しました。")
                self.refresh_tags_table()
            else:
                self.write_log(f"⚠️ DB削除失敗: {db_msg}")
                messagebox.showwarning("部分成功", f"タグの初期化は成功しましたが、DBからの削除に失敗しました:\n{db_msg}")
                
        except Exception as e:
            self.write_log(f"❌ リセットエラー: {e}")
            messagebox.showerror("エラー", f"初期化に失敗しました: {e}")
        finally:
            conn.disconnect()

    # ==================== 仮想タグ（エミュレータ）タブのUIと処理 ====================
    def _build_virtual_tab(self, tab):
        tab.grid_columnconfigure(0, weight=4) # 左
        tab.grid_columnconfigure(1, weight=5) # 右
        tab.grid_rowconfigure(0, weight=1)

        # --- 左半分: 仮想スキャナー ---
        frame_scan = ctk.CTkFrame(tab, corner_radius=8)
        frame_scan.grid(row=0, column=0, padx=(0, 8), pady=10, sticky="nsew")
        
        ctk.CTkLabel(frame_scan, text="💻 仮想タグスキャナー (シミュレータ)", font=("Outfit", 15, "bold"), text_color="#10b981").pack(pady=12)
        
        # 仮想タップボタン
        self.btn_virt_tap = ctk.CTkButton(frame_scan, text="🟢 仮想タグをタップ (Tap)", font=("Outfit", 14, "bold"), fg_color="#10b981", hover_color="#059669", height=38, command=self._execute_virtual_tap)
        self.btn_virt_tap.pack(fill="x", padx=20, pady=10)
        
        # ランダムUID生成
        self.btn_virt_rand = ctk.CTkButton(frame_scan, text="ランダムUID生成", fg_color="transparent", border_width=1, width=120, command=self._execute_virtual_rand_uid)
        self.btn_virt_rand.pack(padx=20, pady=5)
        
        # 仮想UID表示
        ctk.CTkLabel(frame_scan, text="仮想UID (14桁の16進数):", font=("Outfit", 11), text_color="#888").pack(anchor="w", padx=20, pady=(15, 2))
        self.entry_virt_uid = ctk.CTkEntry(frame_scan, font=("Consolas", 14), justify="center")
        self.entry_virt_uid.pack(fill="x", padx=20, pady=4)
        
        # エミュレート用のカウンター
        self.lbl_virt_counter = ctk.CTkLabel(frame_scan, text="タップ回数 (CTR): 0回", font=("Outfit", 12))
        self.lbl_virt_counter.pack(pady=10)

        # --- 右半分: シミュレーション結果 ---
        frame_res = ctk.CTkFrame(tab, corner_radius=8)
        frame_res.grid(row=0, column=1, padx=(8, 0), pady=10, sticky="nsew")
        
        ctk.CTkLabel(frame_res, text="🔗 シミュレーションURL生成", font=("Outfit", 14, "bold"), text_color="#d4af37").pack(pady=12)
        
        ctk.CTkLabel(frame_res, text="WebベースURL (ローカルまたは本番Vercel):", font=("Outfit", 11), text_color="#888").pack(anchor="w", padx=20)
        self.entry_base_url = ctk.CTkEntry(frame_res)
        self.entry_base_url.pack(fill="x", padx=20, pady=4)
        self.entry_base_url.insert(0, self.base_url)
        
        ctk.CTkLabel(frame_res, text="生成された注文用URL (スマホブラウザ検証用):", font=("Outfit", 12, "bold"), text_color="#d4af37").pack(anchor="w", padx=20, pady=(20, 2))
        self.entry_virt_url = ctk.CTkEntry(frame_res, font=("Consolas", 11))
        self.entry_virt_url.pack(fill="x", padx=20, pady=4)
        
        # URLアクション
        frame_url_act = ctk.CTkFrame(frame_res, fg_color="transparent")
        frame_url_act.pack(fill="x", padx=20, pady=25)
        
        self.btn_virt_refresh_url = ctk.CTkButton(frame_url_act, text="URL再計算", width=100, command=self._generate_emulated_url)
        self.btn_virt_refresh_url.pack(side="left", padx=5, fill="x", expand=True)
        
        self.btn_virt_open_browser = ctk.CTkButton(frame_url_act, text="ブラウザで開く", fg_color="#d4af37", hover_color="#bca030", text_color="#000", width=120, command=self._open_virtual_url)
        self.btn_virt_open_browser.pack(side="right", padx=5, fill="x", expand=True)

    def _execute_virtual_rand_uid(self):
        import random
        mock_bytes = bytes(random.choices(range(256), k=7))
        uid_hex = mock_bytes.hex().upper()
        self.entry_virt_uid.delete(0, ctk.END)
        self.entry_virt_uid.insert(0, uid_hex)
        self.virtual_uid = uid_hex
        self.write_log(f"仮想ランダムUIDを生成しました: {uid_hex}")
        self._generate_emulated_url()

    def _execute_virtual_tap(self):
        uid = self.entry_virt_uid.get().strip()
        if not uid or len(uid) != 14:
            # なければランダム生成
            self._execute_virtual_rand_uid()
            uid = self.virtual_uid
            
        current_ctr = self.virtual_counters.get(uid, 0) + 1
        self.virtual_counters[uid] = current_ctr
        self.lbl_virt_counter.configure(text=f"タップ回数 (CTR): {current_ctr}回")
        
        self.write_log(f"[エミュレータ] 仮想タグがタッチされました。 UID: {uid} (CTR: {current_ctr})")
        self._generate_emulated_url()

    def _generate_emulated_url(self):
        uid = self.entry_virt_uid.get().strip()
        if not uid or len(uid) != 14:
            return
            
        master_key_hex = self.entry_master_key.get().strip()
        base_url = self.entry_base_url.get().strip()
        current_ctr = self.virtual_counters.get(uid, 1)
        
        try:
            url = get_ntag_url(base_url, uid, current_ctr, master_key_hex)
            self.entry_virt_url.delete(0, ctk.END)
            self.entry_virt_url.insert(0, url)
        except Exception as e:
            self.write_log(f"エミュレートURL生成失敗: {e}")

    def _open_virtual_url(self):
        url = self.entry_virt_url.get().strip()
        if url:
            self.write_log("エミュレートされたセキュア注文URLをブラウザで開きます。")
            webbrowser.open(url)
        else:
            messagebox.showerror("エラー", "URLが生成されていません。")

    # ==================== 登録済み一覧（データベース）タブのUIと処理 ====================
    def _build_list_tab(self, tab):
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(0, weight=1)  # テーブル
        tab.grid_rowconfigure(1, weight=0)  # コントロール

        # テーブルスタイル設定
        style = ttk.Style()
        # Treeview全体のダークスキン化
        style.theme_use("default")
        style.configure("Treeview",
                        background="#2a2a2a",
                        foreground="#ffffff",
                        rowheight=25,
                        fieldbackground="#2a2a2a",
                        bordercolor="#333",
                        borderwidth=0)
        style.map('Treeview', background=[('selected', '#d4af37')], foreground=[('selected', '#000000')])
        style.configure("Treeview.Heading",
                        background="#1e1e1e",
                        foreground="#ffffff",
                        relief="flat")
        style.map("Treeview.Heading",
                  background=[('active', '#333333')])

        # 表の枠組み
        columns = ("table_id", "serial", "uid", "invalidated_ctr", "current_ctr")
        self.tree = ttk.Treeview(tab, columns=columns, show="headings", style="Treeview")
        
        # 列見出しの設定
        self.tree.heading("table_id", text="テーブル番号")
        self.tree.heading("serial", text="通し番号 (シリアル)")
        self.tree.heading("uid", text="物理NFC UID")
        self.tree.heading("invalidated_ctr", text="会計済カウンター (無効化しきい値)")
        self.tree.heading("current_ctr", text="直近タップカウンター")

        # 列幅の設定
        self.tree.column("table_id", width=100, anchor="center")
        self.tree.column("serial", width=150, anchor="center")
        self.tree.column("uid", width=220, anchor="center")
        self.tree.column("invalidated_ctr", width=220, anchor="center")
        self.tree.column("current_ctr", width=150, anchor="center")

        # スクロールバー
        scrollbar = ttk.Scrollbar(tab, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        self.tree.grid(row=0, column=0, sticky="nsew", padx=(15, 0), pady=15)
        scrollbar.grid(row=0, column=1, sticky="ns", padx=(0, 15), pady=15)

        # 操作ボタン類
        frame_list_ctrl = ctk.CTkFrame(tab, fg_color="transparent")
        frame_list_ctrl.grid(row=1, column=0, columnspan=2, padx=15, pady=(0, 15), sticky="ew")
        
        self.btn_refresh_list = ctk.CTkButton(frame_list_ctrl, text="🔄 最新の情報に更新", width=160, fg_color="#10b981", hover_color="#059669", command=self.refresh_tags_table)
        self.btn_refresh_list.pack(side="left", padx=5)
        
        self.btn_delete_selected = ctk.CTkButton(frame_list_ctrl, text="❌ 選択したタグの登録を削除 (紐付け解除)", fg_color="#f43f5e", hover_color="#e11d48", command=self._delete_selected_tag)
        self.btn_delete_selected.pack(side="right", padx=5)

    def refresh_tags_table(self):
        if not self.supabase_manager:
            return
            
        # 既存データを全消去
        for row in self.tree.get_children():
            self.tree.delete(row)
            
        self.write_log("データベースから登録済みタグ一覧を取得中...")
        
        try:
            tags = self.supabase_manager.get_registered_tags()
            for t in tags:
                # 物理NFCタグ（UIDが14文字の16進数）のみを表示する
                # データベースに登録されている全タグ情報を取得
                uid = t.get("uid", "")
                table_id = t.get("table_id", "未割当")
                serial = t.get("serial_number", "--")
                inv_ctr = t.get("invalidated_ctr", 0)
                cur_ctr = t.get("current_max_ctr", 0)
                
                self.tree.insert("", "end", values=(table_id, serial, uid, inv_ctr, cur_ctr))
                
            self.write_log(f"✅ テーブル表示を更新しました。 (登録件数: {len(tags)} 件)")
        except Exception as e:
            self.write_log(f"❌ タグ一覧取得エラー: {e}")

    def _delete_selected_tag(self):
        selected_item = self.tree.selection()
        if not selected_item:
            messagebox.showwarning("警告", "削除する行を選択してください。")
            return
            
        values = self.tree.item(selected_item[0], "values")
        table_id = values[0]
        uid = values[2]
        
        if not messagebox.askyesno("紐付け解除の確認", f"データベースから以下のタグを削除しますか？\n\nテーブルID: {table_id}\nUID: {uid}\n\n※この操作は物理タグには影響しません。DB内の登録情報のみ削除されます。"):
            return
            
        if not self.supabase_manager:
            return
            
        self.write_log(f"タグ {uid} のDB削除を実行中...")
        success, db_msg = self.supabase_manager.delete_tag(uid)
        
        if success:
            self.write_log("★【成功】データベースからタグを削除しました。")
            messagebox.showinfo("成功", f"タグ {uid} の登録情報をデータベースから削除しました。")
            self.refresh_tags_table()
        else:
            self.write_log(f"⚠️ DB削除失敗: {db_msg}")
            messagebox.showerror("エラー", f"削除に失敗しました: {db_msg}")


if __name__ == "__main__":
    app = TagManagerApp()
    app.mainloop()