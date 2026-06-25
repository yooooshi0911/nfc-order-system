import threading
import time
import random
from typing import Callable, Optional

# nfcpy が動作するか試みる
try:
    import nfc
    HAS_NFCPY = True
except ImportError:
    HAS_NFCPY = False

class NfcHandler:
    def __init__(self, on_tag_detected: Callable[[str, bool], None], log_callback: Callable[[str], None]):
        """
        on_tag_detected: タグ検知時のコールバック。引数は (uid_hex, is_mock)
        log_callback: ログ出力用のコールバック。UIのログエリアに出力する
        """
        self.on_tag_detected = on_tag_detected
        self.log_callback = log_callback
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.clf = None

    def start_listener(self) -> bool:
        """実機NFCリーダーの待受を非同期で開始する"""
        if not HAS_NFCPY:
            self.log_callback("【警告】nfcpy がインストールされていないか、インポートできません。実機NFCリーダーは使用できません。（モックモードのみ動作可能）")
            return False

        if self.running:
            return True

        self.running = True
        self.thread = threading.Thread(target=self._run_nfc_loop, daemon=True)
        self.thread.start()
        return True

    def stop_listener(self):
        """待受を停止する"""
        self.running = False
        # connectループを強制終了するために clf を閉じる
        if self.clf:
            try:
                self.clf.close()
            except Exception:
                pass
            self.clf = None
        self.log_callback("NFCリーダーの待受を停止しました。")

    def _run_nfc_loop(self):
        self.log_callback("NFCリーダーを探しています (USB接続)...")
        try:
            # 汎用USBリーダー (Sony RC-S380等) に接続を試みる
            self.clf = nfc.ContactlessFrontend('usb')
            self.log_callback(f"NFCリーダーを検知しました: {self.clf}")
        except Exception as e:
            self.log_callback(f"【エラー】NFCリーダーの初期化に失敗しました。USB接続を確認してください。: {e}")
            self.log_callback("実機リーダー待受を中止します。（仮想タグエミュレータをご利用ください）")
            self.running = False
            return

        while self.running:
            self.log_callback("NFCタグのタッチを待っています...")
            try:
                # タグ接続処理 (ブロックするが terminate で終了検知)
                target_tag = self.clf.connect(
                    rdwr={
                        'on-connect': self._on_connect
                    },
                    terminate=lambda: not self.running
                )
                
                # connect が正常終了（タグ検知など）した後は、少し待ってループを繰り返す
                time.sleep(1.0)
            except Exception as e:
                if self.running:
                    self.log_callback(f"NFC待受ループ中にエラーが発生しました: {e}")
                    time.sleep(2.0)

    def _on_connect(self, tag) -> bool:
        """実機タグ検知時のハンドラ"""
        # UIDの抽出 (バイナリから14桁の16進数文字列へ)
        uid_hex = tag.identifier.hex().upper()
        self.log_callback(f"物理NFCタグを検知しました! UID: {uid_hex} (Type: {tag.type})")
        
        # メインスレッド(GUI)に通知
        self.on_tag_detected(uid_hex, False)
        
        # True を返すと、接続処理が正常に完了する
        return True

    def trigger_mock_tap(self, custom_uid: Optional[str] = None) -> str:
        """
        GUIの「仮想タグタップ」ボタンから呼び出される。
        ダミーのUIDを生成し、タグ検知イベントを模倣する。
        """
        if custom_uid and len(custom_uid) == 14:
            # 指定された16進UIDを使用
            uid_hex = custom_uid.upper()
        else:
            # ランダムに7バイト(14文字16進)のUIDを生成 (NTAG 424 DNAの標準サイズ)
            mock_bytes = bytes(random.choices(range(256), k=7))
            uid_hex = mock_bytes.hex().upper()

        self.log_callback(f"[シミュレータ] 仮想タグがタップされました。UID: {uid_hex}")
        self.on_tag_detected(uid_hex, True)
        return uid_hex
