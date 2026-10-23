# Collaboration server image. Build from the repository root:
#   docker build -f apps/collab/Dockerfile -t collabverse-collab .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/collab/package.json apps/collab/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @collabverse/collab --workspace @collabverse/shared --include-workspace-root=false
COPY packages/shared packages/shared
COPY apps/collab apps/collab
RUN npm run build --workspace @collabverse/collab

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/collab/package.json ./
RUN npm install --omit=dev --no-package-lock @hocuspocus/server@$(node -p "require('./package.json').dependencies['@hocuspocus/server']") pg@$(node -p "require('./package.json').dependencies.pg") yjs@$(node -p "require('./package.json').dependencies.yjs") \
  && npm cache clean --force
COPY --from=build /repo/apps/collab/dist ./dist
USER node
EXPOSE 1234
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-1234}/health || exit 1
CMD ["node", "dist/index.js"]
