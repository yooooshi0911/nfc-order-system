"""
NTAG 424 DNA 簡易NDEF書き込みテストスクリプト (PC/SC版)

このスクリプトは、PC/SC経由でNTAG 424 DNAタグに
「任意のURL（例: https://google.com）」を書き込むテストを行います。
タグの書き込み・読み込み機能が動作するかをシンプルに確認します。

前提：
- ACS ACR1251 等の PC/SC リーダーがPCに接続されていること
- NTAG 424 DNA タグが工場出荷状態（アクセス制限なし）であること
"""

import sys
import time
from smartcard.System import readers

def send_apdu(conn, apdu):
    """APDUを送信してレスポンスを返す"""
    data, sw1, sw2 = conn.transmit(apdu)
    return data, sw1, sw2

def build_ndef_url_message(url: str) -> bytes:
    """URLからNDEFメッセージ(URIレコード)を組み立てる"""
    # 簡易的なURL接頭辞の判定
    prefixes = [
        "http://www.", "https://www.", "http://", "https://"
    ]
    prefix_code = 0x00
    uri_text = url
    
    for i, p in enumerate(prefixes, start=1):
        if url.startswith(p):
            prefix_code = i
            uri_text = url[len(p):]
            break
            
    uri_bytes = uri_text.encode('utf-8')
    payload = bytes([prefix_code]) + uri_bytes
    
    # NDEF Record Header:
    # MB=1, ME=1, CF=0, SR=1, IL=0, TNF=1 (0xD1)
    # Type Length: 1
    # Payload Length: len(payload)
    # Type: 'U' (0x55)
    header = bytes([0xD1, 0x01, len(payload), 0x55])
    ndef_msg = header + payload
    
    # NDEFファイルの形式は「最初の2バイトがデータ長(Big Endian)」、その後に「データ本体」
    msg_len = len(ndef_msg)
    ndef_file_data = bytes([msg_len >> 8, msg_len & 0xFF]) + ndef_msg
    return ndef_file_data

def write_ndef(conn, url: str):
    print(f"\n書き込むURL: {url}")
    ndef_data = build_ndef_url_message(url)
    print(f"NDEFファイルデータ (HEX): {ndef_data.hex().upper()}")
    
    # 1. NDEF Application 選択
    print("-> NDEF Application を選択中...")
    select_app = [0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]
    data, sw1, sw2 = send_apdu(conn, select_app)
    if not (sw1 == 0x90 and sw2 == 0x00):
        print(f"❌ NDEF Application 選択失敗: SW={sw1:02X}{sw2:02X}")
        return False

    # 2. NDEF File 選択 (EF 0002)
    print("-> NDEF File を選択中...")
    select_file = [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04]
    data, sw1, sw2 = send_apdu(conn, select_file)
    if not (sw1 == 0x90 and sw2 == 0x00):
        print(f"❌ NDEF File 選択失敗: SW={sw1:02X}{sw2:02X}")
        return False

    # 3. 最初に長さ0を書き込んで一時的に無効化 (安全のため)
    print("-> 一時的にデータ長=0を書き込み中...")
    write_zero_len = [0x00, 0xD6, 0x00, 0x00, 0x02, 0x00, 0x00]
    data, sw1, sw2 = send_apdu(conn, write_zero_len)
    if not (sw1 == 0x90 and sw2 == 0x00):
        print(f"❌ 長さの初期化に失敗: SW={sw1:02X}{sw2:02X}")
        return False

    # 4. データ本体を書き込む (Offset = 2)
    payload_to_write = ndef_data[2:]
    print(f"-> データ本体を書き込み中 ({len(payload_to_write)} バイト)...")
    
    # ISO UPDATE BINARY: CLA=00, INS=D6, P1=OffsetMSB, P2=OffsetLSB, Lc=データ長
    # P1/P2 = 00 02 (Offset = 2)
    apdu_write_payload = [0x00, 0xD6, 0x00, 0x02, len(payload_to_write)] + list(payload_to_write)
    data, sw1, sw2 = send_apdu(conn, apdu_write_payload)
    if not (sw1 == 0x90 and sw2 == 0x00):
        print(f"❌ データ本体の書き込みに失敗: SW={sw1:02X}{sw2:02X}")
        return False

    # 5. 正しい長さ（最初の2バイト）を書き戻して有効化
    len_bytes = ndef_data[0:2]
    print(f"-> 正しいデータ長 ({len_bytes.hex().upper()}) を書き込み中...")
    apdu_write_len = [0x00, 0xD6, 0x00, 0x00, 0x02, len_bytes[0], len_bytes[1]]
    data, sw1, sw2 = send_apdu(conn, apdu_write_len)
    if not (sw1 == 0x90 and sw2 == 0x00):
        print(f"❌ 正しい長さの書き込みに失敗: SW={sw1:02X}{sw2:02X}")
        return False

    print("✅ NDEF書き込み成功！")
    return True

def read_ndef(conn):
    """書き込まれたNDEFの読み取りテスト"""
    print("\n-> 書き込まれたNDEFを読み取り検証中...")
    select_app = [0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00]
    send_apdu(conn, select_app)
    select_file = [0x00, 0xA4, 0x00, 0x0C, 0x02, 0xE1, 0x04]
    send_apdu(conn, select_file)
    
    # 長さ読み取り
    data, sw1, sw2 = send_apdu(conn, [0x00, 0xB0, 0x00, 0x00, 0x02])
    if sw1 == 0x90 and sw2 == 0x00:
        nlen = (data[0] << 8) | data[1]
        # 本体読み取り
        data_body, sw1_b, sw2_b = send_apdu(conn, [0x00, 0xB0, 0x00, 0x02, nlen])
        if sw1_b == 0x90 and sw2_b == 0x00:
            # 簡易解析してURLを表示
            payload = bytes(data_body)
            if len(payload) > 4 and payload[3] == 0x55: # 'U'
                prefix_id = payload[4]
                prefixes = {1: "http://www.", 2: "https://www.", 3: "http://", 4: "https://"}
                prefix = prefixes.get(prefix_id, "")
                url_str = prefix + payload[5:].decode('utf-8', errors='ignore')
                print(f"🎉 読み取ったURL: {url_str}")
                return url_str
    print("❌ 読み取り検証失敗")
    return None

def main():
    print("=" * 55)
    print(" NTAG 424 DNA 書き込みテストツール (PC/SC)")
    print("=" * 55)

    r_list = readers()
    if not r_list:
        print("エラー: PC/SCリーダーが見つかりません")
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

    print("\n✅ タグを検知しました。書き込みテストを開始します。")
    
    test_url = "https://google.com"
    success = write_ndef(conn, test_url)
    
    if success:
        read_url = read_ndef(conn)
        if read_url == test_url:
            print("\n★★★ テスト成功！タグへの正常な書き込みと読み取りを確認しました。 ★★★")
        else:
            print("\n⚠️ 書き込みはできましたが、読み取ったデータが一致しませんでした。")
    else:
        print("\n❌ 書き込みテスト失敗")

    conn.disconnect()

if __name__ == '__main__':
    main()
