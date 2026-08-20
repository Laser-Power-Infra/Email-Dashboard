# Frontend Dockerfile - Multi-Stage Build
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy frontend source files
COPY . .

# Build production assets into dist
RUN npm run build

# Stage 2: Nginx Web Server
FROM nginx:alpine

# Copy built static assets from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration for proxying /api/ to backend:6003
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 6002 (mapped 6002:6002 in docker-compose)
EXPOSE 6002

CMD ["nginx", "-g", "daemon off;"]
