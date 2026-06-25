import { SignJWT, jwtVerify } from 'jose';

// JWT 署名用の秘密鍵を環境変数から生成 (32バイト以上の対称鍵とするため SHA-256 ハッシュ化)
async function getJwtSecretKey() {
  const secretStr = process.env.SUPABASE_SECRET_KEY || process.env.MASTER_KEY || 'default-fallback-secret-key-at-least-32chars';
  const encoder = new TextEncoder();
  const data = encoder.encode(secretStr);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

export interface SessionPayload {
  table_id: string;
  ctr: number;
  uid: string;
}

/**
 * セッション情報を JWT トークンとして暗号署名して生成する
 */
export async function encryptSession(payload: SessionPayload): Promise<string> {
  const secret = await getJwtSecretKey();
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h') // 24時間有効
    .sign(secret);
}

/**
 * JWT トークンを検証・復号し、セッション情報を返す。失敗時は null を返す
 */
export async function decryptSession(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = await getJwtSecretKey();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });
    
    return {
      table_id: payload.table_id as string,
      ctr: payload.ctr as number,
      uid: payload.uid as string,
    };
  } catch (e) {
    console.error('Failed to verify session token:', e);
    return null;
  }
}
