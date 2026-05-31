# 安全响应头基线(单一真源)。详见 docs/security-headers.md。
#
# 注意:nginx 的 add_header 不向「已声明自身 add_header 的子 location」继承,
# 因此本片段需在 server{} 与每个含自身 add_header 的 location{} 内分别 `include`。
# 该文件由 Dockerfile COPY 到 /etc/nginx/conf.d/security-headers.inc(.inc 后缀避免被当独立 server 自动加载)。

add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;

# CSP 先以 Report-Only 上线(只上报、不拦截);确认 dist/index.html 实际 sha256 与下方一致、
# 且控制台无违规后,再把 -Report-Only 去掉改为强制。详见 docs/security-headers.md。
add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self' 'sha256-ceZQVieuEu3wrVZesSAxmbWRpR45TuEEt523Sm1QRJs='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'" always;
