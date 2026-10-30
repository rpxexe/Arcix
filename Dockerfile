# Dockerfile for Arcix Persistent WebSocket Signaling Server
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server/ ./server/

EXPOSE 7070

ENV PORT=7070
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
