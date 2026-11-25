# Catraca — imagem multi-stage (deps → build → runtime; dev para os gates)

FROM node:22-alpine AS deps
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src/views ./src/views
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM deps AS dev
COPY . .
CMD ["npm", "run", "gates:inner"]
