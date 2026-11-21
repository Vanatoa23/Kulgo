# syntax=docker/dockerfile:1.7

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.21.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @kulgo/api...

FROM deps AS builder
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY apps/api apps/api
RUN pnpm --filter @kulgo/api... typecheck \
 && pnpm --filter @kulgo/shared exec tsc --noEmit false --module NodeNext --moduleResolution NodeNext --declaration --rootDir src --outDir dist \
 && node -e "const fs = require('fs'); const p = 'packages/shared/package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); pkg.main = './dist/index.js'; pkg.types = './dist/index.d.ts'; pkg.exports = { '.': './dist/index.js' }; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');" \
 && pnpm --filter @kulgo/engine exec tsc --noEmit false --module NodeNext --moduleResolution NodeNext --declaration --rootDir src --outDir dist \
 && node -e "const fs = require('fs'); const p = 'packages/engine/package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); pkg.main = './dist/index.js'; pkg.types = './dist/index.d.ts'; pkg.exports = { '.': './dist/index.js' }; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');" \
 && pnpm --filter @kulgo/api exec tsc --noEmit false --module NodeNext --moduleResolution NodeNext --rootDir src --outDir dist src/server.ts \
 && rm -rf apps/api/tests \
 && CI=true pnpm --filter @kulgo/api... install --prod --frozen-lockfile --ignore-scripts

FROM node:24-slim AS runner
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder --chown=node:node /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=builder --chown=node:node /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules

USER node
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
