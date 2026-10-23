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
# Runtime manifest: only the npm packages the bundle imports, pinned to the
# versions resolved from package-lock.json. The workspace package
# @collabverse/shared is bundled into dist and must not be installed from npm.
RUN node -e 'const l=require("./package-lock.json").packages;const v=(n)=>(l["apps/collab/node_modules/"+n]||l["node_modules/"+n]).version;const deps=Object.fromEntries(["@hocuspocus/server","pg","yjs"].map((n)=>[n,v(n)]));require("fs").writeFileSync("apps/collab/runtime-package.json",JSON.stringify({name:"collabverse-collab",private:true,type:"module",dependencies:deps},null,2));' \
  && cat apps/collab/runtime-package.json

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/collab/runtime-package.json ./package.json
RUN npm install --omit=dev --no-package-lock && npm cache clean --force
COPY --from=build /repo/apps/collab/dist ./dist
USER node
EXPOSE 1234
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-1234}/health || exit 1
CMD ["node", "dist/index.js"]
