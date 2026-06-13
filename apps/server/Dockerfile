# SuperJam server image (Bun + Hono + oRPC). Built from the REPO ROOT context on
# Railway via the service var RAILWAY_DOCKERFILE_PATH=apps/server/Dockerfile.
#
# Pivot-correct (per integrator §11/§18): this image ships NO Claude CLI (agent
# builds run on the dev-box builder VPS) and does NO S3 bundle serving — so we
# neither install `claude` nor copy packages/app-template (dropped via
# .dockerignore; mini-apps are external Vercel URLs). Server runtime needs the
# workspace deps packages/{shared,db,api,logger,onchain,builder} (api imports
# builder for refine + onchain for payments) — copied with the rest of the tree.
#
# No build step: Bun runs the TS entrypoint directly. Env is validated at boot
# (required schema, no SKIP_ENV_VALIDATION at runtime); migrations run in
# server.ts. Listens on $PORT (default 4701), hostname "::" (Railway IPv6).
FROM oven/bun:1.3.14
WORKDIR /app

# Install workspace deps against the committed lockfile. All workspace manifests
# are present (app-template/example-app keep only their package.json) so
# --frozen-lockfile resolves the full graph.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN bun install --frozen-lockfile

ENV PORT=4701
EXPOSE 4701
CMD ["bun", "run", "apps/server/src/server.ts"]
