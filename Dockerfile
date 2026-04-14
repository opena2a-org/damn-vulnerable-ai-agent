FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src/ ./src/
COPY public/ ./public/
EXPOSE 3000 3001 3002 3003 3004 3005 3006 3007 3008 3010 3011 3012 3013 3020 3021
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/index.js"]
