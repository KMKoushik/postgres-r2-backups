FROM node:20.11.1-alpine AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

ENV NPM_CONFIG_UPDATE_NOTIFIER=false
ENV NPM_CONFIG_FUND=false

WORKDIR /app

COPY package*.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:20.11.1-alpine

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ARG PG_VERSION='16'

RUN apk add --update --no-cache postgresql${PG_VERSION}-client --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main

CMD pg_dump --version && \
    node dist/index.js