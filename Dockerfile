# Health Buddy backend.
#
# Multi-stage: the build stage carries the TypeScript compiler, the Prisma CLI
# and every devDependency; the runtime stage carries none of them. A production
# image with a compiler in it is a larger attack surface and a slower pull for
# no benefit.
#
#   docker build -t healthbuddy-backend:latest .
#   docker run --env-file .env -p 5000:5000 healthbuddy-backend:latest

# ---- build ----------------------------------------------------------------
FROM node:22-slim AS build

# openssl is required by Prisma's query engine detection; without it the
# generated client picks the wrong binary target and fails at runtime with a
# message that does not mention openssl.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copied before the source so a change to application code does not invalidate
# the dependency layer — the slowest step by far.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# Slot times are stored as local HH:mm, so a container on UTC opens a 10:00
# consultation at the wrong hour. See ARCHITECTURE.md §12.
ENV TZ=Asia/Kolkata

WORKDIR /app

COPY package.json package-lock.json ./
# --omit=dev leaves out TypeScript, tsx, the test runner and the Prisma CLI.
RUN npm ci --omit=dev && npm cache clean --force

# The generated client and its query engine, built in the stage above.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY public ./public

# Runs as a non-root user. The node image ships one; using it means a container
# escape does not start as root.
USER node

EXPOSE 5000

# Readiness rather than liveness: this asks whether the process can actually
# serve a request, which is what an orchestrator should route on. It returns
# 503 while the database is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are NOT run here. An image that migrates on boot races itself the
# moment you run two replicas, and a rollback then finds a schema from the
# future. Run `npm run prisma:deploy` as a separate step in the deploy.
CMD ["node", "dist/server.js"]
