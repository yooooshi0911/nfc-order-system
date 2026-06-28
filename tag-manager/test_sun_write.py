"""
NTAG 424 DNA SUN機能 (SDM) 書き込みテストスクリプト (PC/SC版)

このスクリプトは、PC/SC接続したカードリーダーを用いて、
NTAG 424 DNA タグに対してSUN機能（セキュリティ動的URL生成）を書き込むテストを行います。
書き込みが完了すると、タグをスマートフォンやリーダーにかざした際、
自動的にUID・タップ回数・暗号署名（MAC）が埋め込まれたURLが生成されるようになります。

【前提】
- ACS ACR1251 等の PC/SC リーダーがPCに接続されていること
- NTAG 424 DNA タグが工場出荷状態（キーがすべて 0x00 * 16）であること
"""

import sys
import time
from smartcard.System import readers
from smartcard.CardConnection import CardConnection

# pylibsdm のインポート
try:
    from pylibsdm.tag.ntag424dna.tag import NTAG424DNA
    from pylibsdm.tag.ntag424dna.structs import (
        FileSettings, FileOption, SDMOptions, SDMAccessRights, AccessRights,
        CommMode, AccessCondition, FileType
    )
except ImportError:
    print("ERROR: pylibsdm がインストールされていません")
    sys.exit(1)

class PcscTagWrapper:
    """pylibsdm が nfcpy の代わりに PC/SC リーダーと対話するためのラッパー"""
    def __init__(self, connection: CardConnection):
        self.connection = connection

    def send_apdu(self, cla, ins, p1, p2, data=b"", mrl=256, check_status=False):
        # ISO/IEC 7816-4 APDU の組み立て
        apdu = [cla, ins, p1, p2]
        if data:
            apdu.append(len(data))
            apdu.extend(list(data))
        
        # Le (mrl) を付与 (0x00 で最大長を要求)
        apdu.append(0x00)
        
        # PC/SC 送信
        res_data, sw1, sw2 = self.connection.transmit(apdu)
        
        # pylibsdm は最後にステータスバイト (sw1, sw2) がくっついた raw データを期待する
        return bytes(res_data) + bytes([sw1, sw2])

def send_raw_apdu(conn, apdu):
    """NDEF書き込み用のシンプルなAPDU送信用関数"""
    data, sw1, sw2 = conn.transmit(apdu)
    return data, sw1, sw2

def write_initial_ndef_url(conn, url: str):
    """
    まず通常のNDEF書き込み手順でURLテンプレートを書き込みます。
    このURL内の '0000...' の部分が、後にタグ自身によってUIDやカウンター、MACに置き換えられます。
    """
    print(f"\n1. URLテンプレートを書き込みます: {url}")
    
    # NDEF URI レコード組み立て (接頭辞 http:// は 0x03)
    prefix_code = 0x03
    uri_text = url
    if url.startswith("http://"):
        prefix_code = 0x03
        uri_text = url[7:]
    elif url.startswith("https://"):
        prefix_code = 0x04
        uri_text = url[8:]
        
    uri_bytes = uri_text.encode('utf-8')
    payload = bytes([prefix_code]) + uri_bytes
    
    # NDEFレコードヘッダー (MB=1, ME=1, SR=1, TNF=1 -> 0xD1)
    ndef_record = bytes([0xD1, 0x01, len(payload), 0x55]) + payload
    
    # NDEFファイル全体のデータ (最初の2バイトはデータ長)
    msg_len = len(ndef_record)
    ndef_file_data = bytes([msg_len >> 8, msg_len & 0xFF]) + ndef_record
    
    # NDEF App 選択
    send_raw_apdu(conn, [0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00])
    # NDEF File 選択
    send_raw_apdu(conn, [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04])
    
    # 長さを一旦 0 で書き込み
    send_raw_apdu(conn, [0x00, 0xD6, 0x00, 0x00, 0x02, 0x00, 0x00])
    
    # データ本体の書き込み
    payload_to_write = ndef_file_data[2:]
    apdu_write = [0x00, 0xD6, 0x00, 0x02, len(payload_to_write)] + list(payload_to_write)
    send_raw_apdu(conn, apdu_write)
    
    # 正しい長さを書き戻し
    len_bytes = ndef_file_data[0:2]
    send_raw_apdu(conn, [0x00, 0xD6, 0x00, 0x00, 0x02, len_bytes[0], len_bytes[1]])
    
    print("   -> URLテンプレートの書き込み完了。")
    return len(ndef_file_data)

def main():
    print("=" * 60)
    print(" NTAG 424 DNA SUN機能 (SDM) アクティベートツール")
    print("=" * 60)

    # 1. リーダー接続
    r_list = readers()
    if not r_list:
        print("エラー: PC/SCリーダーが見つかりません。")
        sys.exit(1)

    reader = r_list[0]
    print(f"使用リーダー: {reader}")
    print("\nタグをカードリーダーに乗せてください...")

    while True:
        try:
            conn = reader.createConnection()
            conn.connect()
            break
        except Exception:
            time.sleep(0.5)

    print("\n✅ タグを検知しました！")
    
    # 書き込むURLテンプレートの定義
    # 000...00 の部分がタグ自身によって自動的に置き換わるプレースホルダーになります。
    # - uid: 14桁の16進数 (14文字)
    # - ctr: 6桁の16進数 (6文字)
    # - mac: 16桁の16進数 (16文字)
    base_url = "https://nfc-order-system.vercel.app/auth"
    url_template = f"{base_url}?uid=00000000000000&ctr=000000&mac=0000000000000000"
    
    try:
        # NDEFファイルを通常書き込み
        write_initial_ndef_url(conn, url_template)
        
        # オフセットの計算
        # プレフィックス http:// (0x03) は1バイトになるため、NDEFデータの開始位置からのバイト数を計算
        # url_template 内でプレフィックスを除いたテキスト
        prefix_len = len("http://")
        text_without_prefix = url_template[prefix_len:]
        
        # 各プレースホルダーのインデックスを取得
        # NDEFレコードのペイロードは NDEFファイルの先頭から7バイト目から始まります。
        payload_start = 7
        
        uid_idx = text_without_prefix.find("uid=")
        ctr_idx = text_without_prefix.find("ctr=")
        mac_idx = text_without_prefix.find("mac=")
        
        if uid_idx == -1 or ctr_idx == -1 or mac_idx == -1:
            print("エラー: URLテンプレートに必要なパラメータが含まれていません。")
            return
            
        uid_offset = payload_start + uid_idx + len("uid=")
        ctr_offset = payload_start + ctr_idx + len("ctr=")
        mac_offset = payload_start + mac_idx + len("mac=")
        mac_input_offset = mac_offset  # PICC CMAC (SV2ベース) のため MAC書き込み位置と同じにする

        print(f"\n2. オフセット計算結果:")
        print(f"   - UID Offset: {uid_offset}")
        print(f"   - CTR Offset: {ctr_offset}")
        print(f"   - MAC Offset: {mac_offset}")
        print(f"   - MAC Input Offset: {mac_input_offset}")

        # 2. pylibsdm によるSDM設定書き込み
        print("\n3. SUN(SDM)機能の設定変更を実行します...")
        
        # ラッパーを作成して NTAG424DNA インスタンスを作成
        wrapper = PcscTagWrapper(conn)
        ntag = NTAG424DNA(wrapper)
        
        # 工場出荷キー(すべて 0x00)を設定
        ntag.set_key(0, b"\x00" * 16) # Master Key (Key 0)
        ntag.set_key(2, b"\x00" * 16) # SDM MAC Key (Key 2)
        
        # 相互認証 (AuthenticateEV2First) を実行
        print("   -> Master Key (Key 0) で認証実行中...")
        ntag.authenticate_ev2_first(0)
        print("   -> 相互認証成功！")
        
        # ファイル設定 (File 2) を定義
        file_settings = FileSettings(
            # SDMを有効にし、通信モードは PLAIN に設定 (URLは暗号化せず平文で読めるようにする)
            file_option=FileOption(sdm_enabled=True, comm_mode=CommMode.PLAIN),
            # ファイル自体のアクセス権限 (読み取りはFREE、書き込み・設定変更はMaster Keyのみ)
            access_rights=AccessRights(
                read=AccessCondition.FREE_ACCESS,
                write=AccessCondition.KEY_0,
                read_write=AccessCondition.KEY_0,
                change=AccessCondition.KEY_0
            ),
            # SDMの設定 (UIDミラー有効、カウンターミラー有効、ASCIIエンコード有効)
            sdm_options=SDMOptions(
                uid=True,
                read_ctr=True,
                read_ctr_limit=False,
                enc_file_data=False,
                tt_status=False,
                ascii_encoding=True
            ),
            # SDMアクセス権 (UID・カウンター読み取りはFREE、MAC生成はKey 2で行う)
            # ※今回すべてのキーが工場出荷状態(all 0x00)なのでKey 0でも2でも暗号計算結果は同じになります。
            sdm_access_rights=SDMAccessRights(
                meta_read=AccessCondition.FREE_ACCESS,
                file_read=AccessCondition.KEY_0,
                ctr_ret=AccessCondition.KEY_0
            ),
            # 各ミラーリングオフセットの設定
            uid_offset=uid_offset,
            read_ctr_offset=ctr_offset,
            mac_offset=mac_offset,
            mac_input_offset=mac_input_offset
        )
        
        # タグのFile 2 (NDEF File) に設定を適用
        print("   -> タグに FileSettings を送信中...")
        ntag.change_file_settings(2, file_settings)
        print("✅ SUN(SDM)機能のアクティベートが正常に完了しました！")
        
        print("\n" + "=" * 60)
        print("★★★ テスト成功！ ★★★")
        print("タグにSUN機能が正常に書き込まれました。")
        print("カードリーダーからタグを離し、もう一度かざして")
        print("test_sun.py を実行すると、動的にURLが変わるかテストできます。")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ エラーが発生しました: {e}")
        print("  → タグがすでにアクティベート済みであるか、キーが工場出荷状態と異なる可能性があります。")
    finally:
        conn.disconnect()

if __name__ == '__main__':
    main()
