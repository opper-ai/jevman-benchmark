# Build the static client with the full toolchain, then run the server on a slim Node image.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
# Serve below a path prefix (e.g. /jevman-benchmark; empty = at the root), and the public origin for share links and
# social-card tags (empty = https://jevman.apps.chadda.se). Both are baked into the client at build time.
ARG APP_BASE_PATH=
ARG VITE_PUBLIC_URL=
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html leaderboard.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY submissions ./submissions
# Replays every submitted game; a submission that does not check out fails the build.
RUN node --import tsx scripts/submissions.ts && APP_BASE_PATH="${APP_BASE_PATH}" VITE_PUBLIC_URL="${VITE_PUBLIC_URL}" npx vite build

# The server on its own, without Opper's secrets loader (CI builds this target for pull requests from forks, which
# cannot pull the private loadsecrets image).
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ARG SOURCE_COMMIT=local
# The server must strip the same prefix the client was built for.
ARG APP_BASE_PATH=
ENV NODE_ENV=production \
    PORT=3000 \
    SOURCE_COMMIT=${SOURCE_COMMIT} \
    APP_BASE_PATH=${APP_BASE_PATH}
WORKDIR /app
# The server uses only Node built-ins, so no node_modules ship in the runtime image.
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
# /health answers at the root whatever APP_BASE_PATH is.
HEALTHCHECK --interval=1s --timeout=1s --start-period=3s --start-interval=1s --retries=2 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "server/main.ts"]

# The deployed image (the default target). loadsecrets, Opper's secrets loader, exports every SSM parameter under
# OPPER_SSM_PREFIXES (set by the ECS task definition) into the environment, then execs CMD, so Node stays PID 1 and
# receives SIGTERM. Outside AWS, run with OPPER_SSM_PREFIXES='[]' to skip SSM. The image is private: building needs
# `docker login ghcr.io`.
FROM runtime
COPY --from=ghcr.io/opper-ai/opper-secrets:v0.3.1 /loadsecrets /usr/local/bin/loadsecrets
ENTRYPOINT ["/usr/local/bin/loadsecrets"]
CMD ["node", "server/main.ts"]
