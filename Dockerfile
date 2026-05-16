# ── Build stage ──────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

# ── Runtime stage ────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js ./
COPY public ./public

USER app
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
