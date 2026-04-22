FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/
COPY public/ ./public/
COPY scenarios/ ./scenarios/
# Drop root. /app needs to stay writable for the .dvaa scores directory and
# for HMA's --fix runs against scenarios/<name>/vulnerable/.
RUN chown -R node:node /app
USER node
EXPOSE 7001 7002 7003 7004 7005 7006 7007 7008 7010 7011 7012 7013 7020 7021 9000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://localhost:9000/stats || exit 1
CMD ["node", "src/index.js"]
