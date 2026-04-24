# DrawSync API

The backend REST API and WebSocket server for the DrawSync Collaborative Canvas Platform.

## 🚀 Overview

DrawSync API is a robust Node.js/Express server that acts as the central hub for the DrawSync platform. It handles user authentication, RESTful resource management, real-time WebSocket state broadcasting, and orchestrates complex AI interactions.

## 🛠️ Technology Stack

- **Runtime:** Node.js (v20+)
- **Framework:** Express 5
- **Database:** MongoDB (Mongoose)
- **Real-time:** Socket.IO (with Redis Adapter support)
- **AI Integration:** Anthropic SDK (Claude), Google Generative AI (Gemini)
- **Background Jobs:** BullMQ + Redis
- **Storage:** AWS S3
- **Authentication:** Firebase Admin SDK

## 📁 Project Structure

- `src/controllers/`: HTTP route handlers (REST endpoints)
- `src/services/`: Core business logic and database interactions
- `src/models/`: Mongoose schemas (Canvas, Elements, Users, etc.)
- `src/socket/`: WebSocket server configuration, room management, and event handlers
- `src/routes/`: Express route definitions
- `src/middleware/`: Auth validation, rate limiting, and error handling
- `src/jobs/`: BullMQ worker definitions (Thumbnails, Cleanup)
- `src/config/`: Environment and third-party SDK initializations

## 🏃‍♂️ Getting Started

### Prerequisites
- Node.js (v20+)
- MongoDB instance (local or Atlas)
- Redis server (optional, but required for multi-server scaling and background jobs)
- Firebase Admin credentials
- Anthropic / Gemini API Keys

### Installation
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables in a `.env` file (Database URIs, API keys, JWT secrets).

### Running Locally

**Development Mode (Hot Reloading):**
```bash
npm run dev
```

**Production Build:**
```bash
npm run build
npm start
```

## ✨ Core Responsibilities

1. **State Synchronization:** The `socket.server.ts` orchestrates rooms and delegates to handlers (`canvas.handler`, `element.handler`) to broadcast state changes natively.
2. **AI Orchestration:** The `ai.service` formats raw JSON canvas states into LLM-friendly context strings and passes images to multimodal models.
3. **Data Integrity:** Ensures strict transactional behavior for nested map updates (like Voice Transcripts) using Mongoose's explicit `.markModified` pattern.
4. **Storage:** Handles pre-signed S3 URL generation for secure, direct-to-cloud asset uploads by the client.
