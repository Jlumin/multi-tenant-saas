FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci && chown -R node:node /app
COPY --chown=node:node . .
USER node
EXPOSE 4200
CMD ["npm", "start"]
