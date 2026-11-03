# The game in one image: the page built once, then a small Node server (serve.ts: the page, the game files, saved
# games) with the multiplayer host beside it. Game files are never in the image: setup/install.sh unpacks your own
# installers into the `game` volume on the first start.
# The base image by digest, so every build starts from the same bytes (NODE_IMAGE overrides it, e.g. from a mirror).
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY .npmrc package.json package-lock.json tsconfig.json ./
COPY packages/client/package.json packages/client/
COPY packages/core/package.json packages/core/
COPY packages/formats/package.json packages/formats/
COPY packages/host/package.json packages/host/
COPY packages/server/package.json packages/server/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages ./packages
# The tables made from VCMI's and the HotA mod's data files: the files fetched from GitHub at the pinned commits (each
# checked against its sha256 in sources.json), then the tables made from them with our patches.
# (Behind a proxy: pass HTTPS_PROXY as a build argument, and its certificate as the secret "ca" if it has its own.)
ARG HTTPS_PROXY
RUN --mount=type=secret,id=ca,required=false NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/run/secrets/ca node packages/vcmi-data/gen/fetch.ts && node packages/vcmi-data/gen/build.ts
RUN npm run build
RUN mkdir -p /runtime/@heroes && cp -a node_modules/ws /runtime/ && cp -a node_modules/@heroes/. /runtime/@heroes/

FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends innoextract ffmpeg git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json tsconfig.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /runtime ./node_modules
COPY setup ./setup
COPY tools ./tools
# Runs as the image's unprivileged user "node" (uid 1000), never root: it owns only the game files' and saved games'
# volumes (and the language packs, under /state); the code it runs is root's and read-only to it.
RUN mkdir -p /game /state && chown node:node /game /state && ln -s /state/cache /app/.cache
USER node
ENV HEROES_DATA_DIRS=/game/gog/Data:/game/hota/app/Data \
    HEROES_MUSIC_DIRS=/game/gog/Mp3:/game/hota/app/mp3 \
    HEROES_MAP_DIRS=/game/gog/Maps:/game/hota/app/Maps \
    HEROES_LOOSE_DIRS=/installers/hota-mod:/game/hota/app/_HD3_Data/Common \
    HEROES_ROOMS_DIR=/state/rooms \
    SAVES_DIR=/state/saves \
    L10N_DIR=/state/l10n \
    AUTH_DIR=/state/limits \
    PORT=8080
EXPOSE 8080
CMD ["sh", "/app/setup/start.sh"]
