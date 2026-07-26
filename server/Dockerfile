# /server/Dockerfile — Node 22 slim, production deps only, non-root. Per ADR BD-DOCS-041.
# Index digest verified against Docker Registry for node:22-slim on 2026-07-24.
FROM node:22-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

# Provenance-only build inputs. Never pass credentials or runtime configuration as build args.
ARG OCI_SOURCE="https://github.com/iprus2026-tech/BazarDriveCloud"
ARG OCI_REVISION="unknown"
LABEL org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.title="BazarDrive API" \
      org.opencontainers.image.description="BazarDrive Fastify API container"

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

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const port=process.env.PORT||'3000';fetch('http://127.0.0.1:'+port+'/api/v1/health').then(async(r)=>{const b=await r.json();if(r.status!==200||b.status!=='ok'||b.service!=='@bazardrive/server')process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/index.js"]
