FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY web ./web
RUN pnpm check

FROM node:24.19.0-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web
RUN mkdir -p /app/.innovox && chown node:node /app/.innovox
USER node
ENV INNOVOX_HOST=0.0.0.0 INNOVOX_PORT=4317 INNOVOX_DATABASE=/app/.innovox/state.sqlite
EXPOSE 4317
CMD ["node", "dist/src/main.js"]
