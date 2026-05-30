# syntax=docker/dockerfile:1.6
# 多阶段构建：node:20-alpine 编译产物 → nginx:alpine 托管静态文件。
# 关键不变量：
#  - npm ci 之前先 COPY package*.json，让依赖层在源码变更时仍能复用缓存。
#  - 第二阶段不带任何 node 依赖，最终镜像 ≈ nginx:alpine 基础 (~25MB) + dist (~数 MB)。
#  - 必须执行 `npm run build`，触发 scripts/inject-sw-build-id.mjs，
#    把 dist/sw.js 中的 __CACHE_NAME__ 占位符替换为 image-playground-<hash>-<ts>。

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先装依赖：拆开 COPY 让 layer 缓存生效
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码并构建
COPY . .
RUN npm run build \
    && test -f dist/sw.js \
    && ! grep -q '__CACHE_NAME__' dist/sw.js

# ---------- Stage 2: serve ----------
FROM nginx:alpine AS runtime

# 用我们自己的 server 配置替换默认 default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
# 安全响应头基线片段(被 nginx.conf 各 location include;.inc 后缀避免被当独立 server 自动加载)
COPY nginx-security-headers.inc /etc/nginx/conf.d/security-headers.inc

# 拷贝构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine 默认 CMD 已是 `nginx -g 'daemon off;'`，不覆盖。
