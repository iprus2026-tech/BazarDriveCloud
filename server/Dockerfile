# /server/Dockerfile — Node 22 slim, production deps only, non-root. Per ADR BD-DOCS-041.
FROM node:22-slim

WORKDIR /app

# Install production dependencies against the committed lockfile (reproducible).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source + migrations.
COPY . .

# Run as the built-in non-root user.
USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
