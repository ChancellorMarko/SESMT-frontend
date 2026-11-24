# syntax=docker/dockerfile:1

# ─── Stage 1: build ────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .

ARG VITE_API_MODE=api
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_API_BROWSER_PREFIX=/browser
ARG VITE_AUTH_CONTRACT_KIND=native
ENV VITE_API_MODE=$VITE_API_MODE \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_API_BROWSER_PREFIX=$VITE_API_BROWSER_PREFIX \
    VITE_AUTH_CONTRACT_KIND=$VITE_AUTH_CONTRACT_KIND

RUN npm run build

# ─── Stage 2: runtime ──────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS final

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/app.conf
COPY --from=build /app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1

EXPOSE 80