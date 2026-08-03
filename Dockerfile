# Optional Docker / VPS image (Railway uses Nixpacks by default now)
FROM node:22-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY artifacts ./artifacts
COPY lib ./lib
RUN mkdir -p scripts \
  && printf '%s\n' '{"name":"scripts","private":true}' > scripts/package.json \
  && sed -i 's/minimumReleaseAge: 1440/minimumReleaseAge: 0/' pnpm-workspace.yaml \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @workspace/api-server run build \
  && pnpm prune --prod \
  && pnpm --filter @workspace/db add -D drizzle-kit || true

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
CMD ["/entrypoint.sh"]
