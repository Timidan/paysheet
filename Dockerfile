FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY --from=web /web/dist ./web/dist
RUN mkdir data && chown node data
USER node
ENV PAYSHEET_KEY_FILE=/run/paysheet.key
CMD ["node", "src/server.mjs"]
