# Backend Dockerfile - Match Emails Portal Node.js API Service
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install system dependencies if required for native addons
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure data and cache directories exist with full permissions
RUN mkdir -p data cache

# Expose container port (mapped to 6003 in docker-compose)
EXPOSE 6003

# Environment variables defaults
ENV PORT=6003
ENV NODE_ENV=production
ENV SYNC_INTERVAL_SECONDS=30

# Start Express Backend Server
CMD ["node", "server.js"]
