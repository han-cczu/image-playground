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

# 再拷源码并构建。
# GIT_COMMIT:构建上下文排除了 .git(.dockerignore),容器内 git 命令必失败,CACHE_NAME 会退化为
# nogit-<timestamp>(时间戳仍保证每次构建唯一,SW 缓存轮换不受影响,只是失去与代码版本的对应)。
# 构建时传入即可恢复:docker build --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) ...
ARG GIT_COMMIT=
ENV GIT_COMMIT=${GIT_COMMIT}
COPY . .
# 双占位符残留校验:__PRECACHE_MANIFEST__ 在 sw.js 里是优雅退化设计(残留则解析为空数组,
# 离线静默降级为部分缓存),不像 __CACHE_NAME__ 会自爆——必须在产物层兜底
RUN npm run build \
    && test -f dist/sw.js \
    && ! grep -qE '__CACHE_NAME__|__PRECACHE_MANIFEST__' dist/sw.js

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
