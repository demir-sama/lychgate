import type { NextConfig } from "next";

// React dev tooling needs eval; production never gets it.
const scriptSrc = process.env.NODE_ENV === "development" ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src https://web.archive.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default config;
