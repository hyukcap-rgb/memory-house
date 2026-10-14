FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
RUN mkdir -p /app/.data && chown bun:bun /app/.data
USER bun
CMD ["bun", "run", "src/server.ts"]
