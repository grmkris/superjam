# SuperJam web (Next.js 16 host shell). Built from the REPO ROOT context on
# Railway via the service var RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile.
#
# next.config.ts has no output:'standalone' (it's the frontend lane's file), so
# this is a plain `next build` + `next start` image (heavier than standalone, fine
# for dev). NEXT_PUBLIC_* are inlined at BUILD time, so Railway service vars are
# declared as ARGs here (§18). SKIP_ENV_VALIDATION bypasses the required server
# schema during build (the client only needs the NEXT_PUBLIC_* inlines).
# Not --frozen-lockfile: bun.lock drifts across lanes (see apps/server/Dockerfile).
FROM oven/bun:1.3.14
WORKDIR /app

COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install

# Build-time public config (Railway passes service variables as build args).
ARG NEXT_PUBLIC_APP_ENV
ARG NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV \
    NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=$NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID \
    SKIP_ENV_VALIDATION=1 \
    NODE_ENV=production
RUN bun run --filter web build

# Serve. Fixed port 3000 to match the gateway's WEB_URL=…:3000 private upstream;
# bind 0.0.0.0 so Railway's network can reach it.
ENV PORT=3000
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["bunx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
