# MeetingBot API System

This directory contains the API-based bot management system that allows you to launch and control multiple MeetingBot instances through REST API calls instead of environment variables.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd src/api
npm install
```

### 2. Start the API Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000`

### 3. Launch Your First Bot

#### Using cURL:
```bash
curl -X POST http://localhost:3000/api/bots \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/your-meeting-id",
    "platform": "google",
    "userId": "your-user-id",
    "meetingTitle": "Test Meeting",
    "botDisplayName": "RecordingBot"
  }'
```

#### Using the Web Interface:
Open `http://localhost:3000` in your browser for a user-friendly interface.

#### Using the Node.js Client:
```bash
node client-example.js basic
```

## 📖 API Documentation

### Bot Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/bots` | Launch a new bot |
| `GET` | `/api/bots` | List all bots |
| `GET` | `/api/bots/:id` | Get bot status |
| `GET` | `/api/bots/:id/logs` | Get bot logs |
| `DELETE` | `/api/bots/:id` | Stop a bot |

### System Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | System statistics |
| `GET` | `/health` | Health check |
| `GET` | `/` | Web interface |

### Launch Bot Request

```json
{
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "platform": "google|zoom|teams",
  "userId": "user123",
  "meetingTitle": "Meeting Title",
  "botDisplayName": "RecordingBot",
  "automaticLeave": {
    "waitingRoomTimeout": 60000,
    "noOneJoinedTimeout": 300000,
    "everyoneLeftTimeout": 60000
  },
  "recordingSettings": {
    "format": "mp3",
    "segmentDuration": 60,
    "quality": "medium"
  }
}
```

### Bot Status Response

```json
{
  "botId": "bot_1638360000000_abc123def",
  "status": "recording|waiting|completed|failed",
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "platform": "google",
  "meetingTitle": "Test Meeting",
  "userId": "user123",
  "participantCount": 3,
  "recordingDuration": 1800,
  "createdAt": "2025-07-29T12:00:00.000Z",
  "recordingStartedAt": "2025-07-29T12:01:00.000Z",
  "lastHeartbeat": "2025-07-29T12:30:00.000Z"
}
```

## 🛠️ Client Examples

### Node.js Client

```javascript
const MeetingBotClient = require('./client-example.js');

const client = new MeetingBotClient('http://localhost:3000');

// Launch a bot
const bot = await client.launchBot({
  meetingUrl: 'https://meet.google.com/abc-defg-hij',
  platform: 'google',
  userId: 'user123',
  meetingTitle: 'Team Meeting'
});

console.log('Bot launched:', bot.botId);

// Monitor bot status
await client.monitorBot(bot.botId, (status) => {
  console.log(`Bot status: ${status.status}`);
});
```

### Python Client

```python
import requests
import time

class MeetingBotClient:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url
    
    def launch_bot(self, config):
        response = requests.post(f"{self.base_url}/api/bots", json=config)
        return response.json()
    
    def get_bot_status(self, bot_id):
        response = requests.get(f"{self.base_url}/api/bots/{bot_id}")
        return response.json()
    
    def monitor_bot(self, bot_id):
        while True:
            status = self.get_bot_status(bot_id)
            print(f"Bot {bot_id}: {status['status']}")
            
            if status['status'] in ['completed', 'failed']:
                break
                
            time.sleep(5)

# Usage
client = MeetingBotClient()

bot = client.launch_bot({
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "platform": "google",
    "userId": "user123",
    "meetingTitle": "Python Bot Test"
})

client.monitor_bot(bot['botId'])
```

### cURL Examples

```bash
# Launch bot
curl -X POST http://localhost:3000/api/bots \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl":"https://meet.google.com/abc-defg-hij","platform":"google","userId":"user123"}'

# Get bot status
curl http://localhost:3000/api/bots/bot_1638360000000_abc123def

# List all bots
curl http://localhost:3000/api/bots

# Stop bot
curl -X DELETE http://localhost:3000/api/bots/bot_1638360000000_abc123def

# Get system stats
curl http://localhost:3000/api/stats
```

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │───▶│   API Server     │───▶│   Bot Process   │
│                 │    │   (Express.js)   │    │   (Node.js)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                         │
                              ▼                         ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │  In-Memory DB    │    │   AWS S3        │
                       │  (Production:    │    │  (Recordings)   │
                       │   PostgreSQL)    │    │                 │
                       └──────────────────┘    └─────────────────┘
```

### Components

1. **API Server** (`server.js`): Express.js server that manages bot lifecycle
2. **Bot Manager**: Spawns and monitors individual bot processes
3. **Bot Processes**: Individual Node.js processes running the meeting bots
4. **Storage**: In-memory storage (can be replaced with PostgreSQL for production)
5. **Recordings**: Audio files uploaded to AWS S3 or LocalStack

## 🔧 Configuration

### Environment Variables

```bash
# API Server
PORT=3000
NODE_ENV=development

# AWS Configuration (for recordings)
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_BUCKET_NAME=meetingbot-recordings

# For local development with LocalStack
AWS_ENDPOINT=http://localhost:4566
```

### Production Considerations

1. **Database**: Replace in-memory storage with PostgreSQL
2. **Process Manager**: Use PM2 or similar for process management
3. **Load Balancer**: Use NGINX for multiple API server instances
4. **Monitoring**: Add Prometheus metrics and Grafana dashboards
5. **Security**: Add authentication and rate limiting
6. **Docker**: Containerize for easier deployment

## 📊 Monitoring

### Web Interface
Access `http://localhost:3000` for a real-time dashboard showing:
- Active bots
- Bot status and logs
- System statistics
- Bot launch form

### API Endpoints
- `/health` - Health check
- `/api/stats` - System statistics
- `/api/bots/:id/logs` - Bot logs

### Logs
The API server logs all activities to the console:
```
🚀 Launched bot bot_123 with PID 12345 for https://meet.google.com/abc-defg-hij
📟 Bot bot_123: Joined Call
📟 Bot bot_123: Recording Started
🏁 Bot bot_123 completed with code 0
```

## 🚀 Scaling

### Horizontal Scaling
1. Run multiple API server instances
2. Use a load balancer (NGINX, AWS ALB)
3. Shared database for bot coordination
4. Redis for real-time status updates

### Bot Resource Management
1. Limit concurrent bots per server
2. Queue bot launches during high load
3. Auto-scale based on demand
4. Monitor system resources

### Example Load Balancer Config (NGINX)
```nginx
upstream meetingbot_api {
    server localhost:3000;
    server localhost:3001;
    server localhost:3002;
}

server {
    listen 80;
    location / {
        proxy_pass http://meetingbot_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 🔐 Security

### Authentication (TODO)
Add JWT token-based authentication:

```javascript
const jwt = require('jsonwebtoken');

// Middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.sendStatus(401);
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Apply to protected routes
app.use('/api/bots', authenticateToken);
```

### Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api', limiter);
```

## 🐛 Troubleshooting

### Common Issues

1. **Bot fails to launch**
   - Check if dependencies are installed
   - Verify AWS credentials
   - Check LocalStack is running for development

2. **API server crashes**
   - Check Node.js version (>=18 required)
   - Verify port 3000 is available
   - Check system resources

3. **Recordings not saved**
   - Verify AWS/LocalStack connection
   - Check ffmpeg installation
   - Review bot logs

### Debug Commands

```bash
# Check API server health
curl http://localhost:3000/health

# View bot logs
curl http://localhost:3000/api/bots/BOT_ID/logs

# List all processes
ps aux | grep tsx

# Check LocalStack
docker logs localstack

# Monitor system resources
htop
```

## 📝 Development

### Adding New Features

1. **New API Endpoints**: Add to `server.js`
2. **Bot Features**: Modify bot code in `../bots/`
3. **Client Libraries**: Extend `client-example.js`
4. **Web Interface**: Update HTML in server.js

### Testing

```bash
# Run API server tests
npm test

# Test with different platforms
node client-example.js basic
node client-example.js multiple
node client-example.js management

# Load testing
curl -X POST http://localhost:3000/api/bots \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl":"https://meet.google.com/test","platform":"google","userId":"load-test"}' &
```

This API system transforms MeetingBot from a single-use tool into a scalable service that can manage hundreds of concurrent meeting recordings!
