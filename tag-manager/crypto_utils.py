import binascii
from Crypto.Hash import CMAC
from Crypto.Cipher import AES

def aes128_cmac(key: bytes, data: bytes) -> bytes:
    """AES-128 CMACを計算する"""
    c = CMAC.new(key, ciphermod=AES)
    c.update(data)
    return c.digest()

def get_child_key(master_key: bytes, uid: bytes) -> bytes:
    """マスターキーとUIDから、個別暗号キー (K_child) を導出する"""
    return aes128_cmac(master_key, uid)

def calculate_sdm_mac(child_key: bytes, uid: bytes, ctr_value: int) -> str:
    """
    NTAG 424 DNA の SUN 機能における MAC (NXP公式仕様: 1::2スライス奇数バイト) を計算する。
    """
    # 1. SV (Session Vector) の構築
    sv = bytearray(16)
    sv[0:6] = [0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]
    sv[6:13] = uid
    sv[13:16] = ctr_value.to_bytes(3, byteorder='little')
    
    # 2. セッションキー K_ses_sdm_mac の導出 (child_key をベースとする)
    k_ses_sdm_mac = aes128_cmac(child_key, bytes(sv))
    
    # 3. 最終的な CMAC 計算 (ファイルデータは空なので、入力は空 b"")
    final_cmac = aes128_cmac(k_ses_sdm_mac, b"")
    
    # 4. NXP独自仕様: 奇数バイトのみを抽出 (1::2)
    mac_bytes = final_cmac[1::2]
    return binascii.hexlify(mac_bytes).decode('utf-8').upper()

def get_ntag_url(base_url: str, uid_hex: str, ctr_value: int, master_key_hex: str) -> str:
    """
    指定されたUID、カウンター値、マスターキーから
    NTAG 424 DNAが生成する暗号化URLをエミュレートする
    """
    master_key = binascii.unhexlify(master_key_hex)
    uid = binascii.unhexlify(uid_hex)
    
    # 1. K_childの算出
    child_key = get_child_key(master_key, uid)
    
    # 2. SDM MACの算出
    ctr_hex = f"{ctr_value:06X}" # 6桁の16進数 (例: "00002A")
    # URL用のカウンターはリトルエンディアンテキストではなく、ビッグエンディアン形式が使われることが多い
    # (例: ctr=00002A -> 10進数で42)
    # ここでは仕様通り、ctrパラメータをそのまま数値にして、
    # 内部CMACの計算時はctr_valueを3バイトリトルエンディアンにしてSV2に設定し、URLのパラメータには大文字のctr_hexを設定する。
    mac = calculate_sdm_mac(child_key, uid, ctr_value)
    
    # URLの組み立て
    connector = "&" if "?" in base_url else "?"
    return f"{base_url}{connector}uid={uid_hex.upper()}&ctr={ctr_hex}&mac={mac}"
