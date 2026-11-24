import type { NextConfig } from "next";

// A CSP (com nonce por requisição) é definida em src/proxy.ts.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // esconde o botão "N" das ferramentas do Next, que só aparece rodando localmente (npm run dev)
  devIndicators: false,
  // voltar a uma seção aberta há menos de 30 s é instantâneo; salvar qualquer coisa limpa esse cache (revalidatePath)
  experimental: { staleTimes: { dynamic: 30 } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
