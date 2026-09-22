FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
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

USER appuser

ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server.js"]
