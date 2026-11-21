FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
EXPOSE 5000
# Seeds the demo marketplace on the very first start (skipped when the database already has data), then runs the API
CMD ["sh", "-c", "node src/seed.js --if-empty && node src/server.js"]
