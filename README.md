
# ZipLink — URL Shortener

[![TypeScript](https://img.shields.io/badge/TypeScript-Language-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Redis](https://img.shields.io/badge/Redis-Caching-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Containerization-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-Styling-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Render](https://img.shields.io/badge/Render-Deployed-46E3B7?logo=render&logoColor=black)](https://render.com/)

A full-stack URL shortening application built to explore caching strategies, Redis integration, rate limiting, and Docker-based deployment.

**Live Demo:** https://ziplink-hah1.onrender.com  
**GitHub Repository:** https://github.com/anshika-pathak005/ziplink

## Features

- **URL Shortening:** Convert long URLs into short, shareable links with automatic redirection.
- **User Authentication:** Sign up and log in to access a personalized dashboard.
- **Link Management:** View and manage shortened URLs from the dashboard.
- **Redis Caching:** Implement caching using Upstash Redis and a standard Redis server to understand cache integration and improve repeated data access.
- **Rate Limiting:** Restrict repeated requests to authentication and URL-shortening endpoints.
- **Fallback Handling:** Support alternative Redis configurations, including an in-memory fallback when an external Redis provider is unavailable.
- **Docker Containerization:** Build and run the application inside a Docker container using a multi-stage Dockerfile.
- **Cloud Deployment:** Deploy the application on Render with environment-based configuration.

## Tech Stack

- **Frontend:** React, TanStack Start, TanStack Router, Tailwind CSS
- **Backend:** TanStack Start server functions, TypeScript
- **Database:** PostgreSQL, Drizzle ORM
- **Caching & Rate Limiting:** Redis, Upstash Redis
- **Containerization:** Docker
- **Deployment:** Render
- **Build Tools:** Vite, Nitro

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/)
- PostgreSQL
- Redis or Upstash Redis

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/anshika-pathak005/ziplink.git
   cd ziplink
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Create your environment file:

   ```bash
   cp .env.example .env
   ```

4. Configure the required environment variables in `.env`.

5. Apply the database schema:

   ```bash
   bunx drizzle-kit push
   ```

6. Start the development server:

   ```bash
   bun run dev
   ```

   Open `http://localhost:3000`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Base URL used to generate short links |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis authentication token |
| `REDIS_URL` | Standard Redis connection URL |
| `NODE_ENV` | Application environment |

Configure either both Upstash Redis variables or a standard Redis URL. Keep credentials in environment variables and never commit `.env`.

## Docker

Build the Docker image and run the application:

```bash
docker build -t ziplink .
docker run --rm -p 3000:10000 --env-file .env.docker ziplink
```

Provide the required environment variables before starting the container.

## Author

**Anshika Pathak**

- GitHub: [anshika-pathak005](https://github.com/anshika-pathak005)
- LinkedIn: [LinkedIn Profile](https://www.linkedin.com/in/anshikapathak7/)
