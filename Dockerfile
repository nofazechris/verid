# Verid web app (dashboard + API + docs) as a container. Railway uses this file automatically (it detects a Dockerfile
# at the repo root), and so does any host that runs Docker. The Render blueprint (render.yaml) does not use it.
#
#   docker build -t verid .
#   docker run -p 3000:3000 -e PORT=3000 --env-file apps/web/.env.local verid
#
# Secrets are NEVER baked into the image (.dockerignore keeps every .env file and .arc-secrets out); they arrive as
# runtime environment variables. The one build-time value is not secret: the explorer link base, below.
FROM node:20-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* values are compiled into the page code, so they must exist when `next build` runs. Railway passes
# service variables to a Dockerfile build as build arguments, but only the ones declared here.
ARG NEXT_PUBLIC_ARC_EXPLORER_URL
ENV NEXT_PUBLIC_ARC_EXPLORER_URL=$NEXT_PUBLIC_ARC_EXPLORER_URL
ARG NEXT_PUBLIC_CONTACT_EMAIL
ENV NEXT_PUBLIC_CONTACT_EMAIL=$NEXT_PUBLIC_CONTACT_EMAIL

# No secrets are needed to build; the app only requires them to RUN.
RUN pnpm --filter @verid/web build

ENV NODE_ENV=production
# The host sets PORT; `next start` listens on it, on all interfaces.
EXPOSE 3000
CMD ["pnpm", "--filter", "@verid/web", "start"]
