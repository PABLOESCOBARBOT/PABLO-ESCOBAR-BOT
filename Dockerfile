# Permanent 24/7 image — Casino + Admin Telegram bots
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY artifacts ./artifacts
COPY lib ./lib
# workspace lists optional `scripts` package — create stub if missing from checkout
RUN mkdir -p scripts && printf '%s\n' '{"name":"scripts","private":true}' > scripts/package.json
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @workspace/api-server run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.33.3 --activate

COPY --from=build /app /app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
CMD ["/entrypoint.sh"]
