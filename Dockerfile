FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/
COPY public/ ./public/
COPY scenarios/ ./scenarios/
# Pre-generate HMA's check-metadata registry so the first /scan after the
# container starts is fast (~200ms) instead of paying the ~20s HMA
# fixture-scan cost. The cache is keyed by HMA version; an HMA upgrade
# auto-invalidates via scanner.js's version check.
RUN mkdir -p /app/.hackmyagent-cache && \
    HMA_VER=$(node_modules/.bin/hackmyagent --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) && \
    node_modules/.bin/hackmyagent check-metadata \
      > "/app/.hackmyagent-cache/check-metadata-v${HMA_VER}.json"
# Drop root. /app needs to stay writable for the .dvaa scores directory and
# for HMA's --fix runs against scenarios/<name>/vulnerable/.
RUN chown -R node:node /app
USER node
EXPOSE 7001 7002 7003 7004 7005 7006 7007 7008 7010 7011 7012 7013 7020 7021 9000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://localhost:9000/stats || exit 1
CMD ["node", "src/index.js"]
