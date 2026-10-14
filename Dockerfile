# Klik : l'app (fichiers statiques) et l'API des setlists partagées, dans un seul container.
# Les setlists sont dans /data : y monter un volume persistant (Coolify : « Persistent Storage »).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    APP_DIR=/app

WORKDIR /app
COPY . .
RUN mkdir -p /data && chown node:node /data

# Pas de « USER node » : le serveur démarre en root, donne /data à l'utilisateur node (le volume
# monté par Coolify appartient souvent à root), puis passe lui-même en node (voir dropPrivileges).
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/server.js"]
