# Chat Widget Demo

React + Vite + Tailwind Crisp‑style chat widget that talks to a FastAPI `/messages` endpoint.

## Setup
```bash
npm i
npm run dev
```
(or fill `.env` first)

### .env
```
VITE_API_URL=http://localhost:8000
VITE_CONVERSATION_ID=conv_demo_001
```

### Backend quick test
```bash
curl -X POST http://localhost:8000/messages   -H "Content-Type: application/json"   -d '{"conversation_id":"conv_demo_001","text":"hello"}'
```

### CORS (if needed)
Configure FastAPI's CORSMiddleware to allow `http://localhost:5173`.
