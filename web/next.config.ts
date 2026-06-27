import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // 外部(スマホ等)からIPアドレスでアクセスした際にJSがブロックされるのを防ぐ設定
  // ネットワーク内のデバイスを許可する。
  allowedDevOrigins: ['192.168.0.194', 'localhost'],
};

export default nextConfig;
