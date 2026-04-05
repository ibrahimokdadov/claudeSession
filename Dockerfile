FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY --from=builder /app/web/dist ./web/dist
ENV PORT=3333
EXPOSE 3333
CMD ["node", "src/server.js"]
