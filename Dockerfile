FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S appgroup \
  && adduser -S appuser -u 1001 -G appgroup

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY server ./server

USER appuser

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
