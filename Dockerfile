FROM node:24-alpine

WORKDIR /app

# Copy backend dependencies and install
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend source and pre-built mobile PWA dist
COPY backend/ ./backend/
COPY mobile/dist/ ./mobile/dist/

# Ensure persistent directories exist for SQLite DB and Voice Notes
RUN mkdir -p /app/backend/data /app/backend/uploads

WORKDIR /app/backend

EXPOSE 4000

CMD ["node", "server.js"]
