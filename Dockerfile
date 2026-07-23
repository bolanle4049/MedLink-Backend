# MedLink backend — container image for Render (or any Docker host).
FROM node:20-slim

# Prisma's query engine needs OpenSSL + CA certs at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching). Copy the Prisma schema before
# `npm ci` so the postinstall `prisma generate` has it.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

# Build the app (prisma generate + tsc -> dist/).
COPY . .
RUN npm run build

ENV NODE_ENV=production

# Render injects PORT; the app reads process.env.PORT and binds 0.0.0.0.
# On start, sync the schema to the database, then boot.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && node dist/index.js"]
