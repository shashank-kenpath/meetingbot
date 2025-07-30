# API-Based Bot Management System

This guide explains how to launch and manage multiple MeetingBot instances through REST API calls instead of environment variables.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │───▶│   Bot Manager    │───▶│   Bot Instance  │
│                 │    │   API Server     │    │   (Google Meet) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                         │
                              ▼                         ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │    Database      │    │   AWS S3        │
                       │   (PostgreSQL)   │    │  (Recordings)   │
                       └──────────────────┘    └─────────────────┘
```

## Quick Start

### 1. Start the Bot Manager API Server

```bash
cd src/server
npm run dev
# Server starts on http://localhost:3000
```

### 2. Launch a Bot via API

```bash
curl -X POST http://localhost:3000/api/bots \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "platform": "google",
    "botDisplayName": "RecordingBot",
    "userId": "user123",
    "meetingTitle": "Project Standup",
    "automaticLeave": {
      "waitingRoomTimeout": 60000,
      "noOneJoinedTimeout": 300000,
      "everyoneLeftTimeout": 60000
    }
  }'
```

## API Endpoints

### Bot Management

#### Create and Launch Bot
```http
POST /api/bots
Content-Type: application/json

{
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "platform": "google|zoom|teams",
  "botDisplayName": "RecordingBot",
  "userId": "user123",
  "meetingTitle": "Meeting Title",
  "automaticLeave": {
    "waitingRoomTimeout": 60000,
    "noOneJoinedTimeout": 300000,
    "everyoneLeftTimeout": 60000
  },
  "recordingSettings": {
    "format": "mp3|mp4",
    "segmentDuration": 60,
    "quality": "high|medium|low"
  }
}
```

**Response:**
```json
{
  "botId": "bot_123456",
  "status": "launching",
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "platform": "google",
  "createdAt": "2025-07-29T12:00:00Z",
  "estimatedStartTime": "2025-07-29T12:00:30Z"
}
```

#### Get Bot Status
```http
GET /api/bots/{botId}
```

**Response:**
```json
{
  "botId": "bot_123456",
  "status": "recording|waiting|completed|failed",
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "platform": "google",
  "participantCount": 3,
  "recordingDuration": 1800,
  "recordingSegments": 30,
  "createdAt": "2025-07-29T12:00:00Z",
  "startedAt": "2025-07-29T12:00:30Z",
  "lastHeartbeat": "2025-07-29T12:30:00Z"
}
```

#### List All Bots
```http
GET /api/bots?status=active&userId=user123&limit=50&offset=0
```

**Response:**
```json
{
  "bots": [
    {
      "botId": "bot_123456",
      "status": "recording",
      "meetingTitle": "Project Standup",
      "platform": "google",
      "createdAt": "2025-07-29T12:00:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Stop Bot
```http
DELETE /api/bots/{botId}
```

**Response:**
```json
{
  "botId": "bot_123456",
  "status": "stopping",
  "message": "Bot stop initiated. Recording will be finalized and uploaded."
}
```

### Recording Management

#### Get Recording Info
```http
GET /api/recordings/{botId}
```

**Response:**
```json
{
  "botId": "bot_123456",
  "recordingUrl": "https://s3.amazonaws.com/bucket/recordings/bot_123456.mp3",
  "duration": 1800,
  "fileSize": 15728640,
  "format": "mp3",
  "uploadedAt": "2025-07-29T12:32:00Z",
  "segments": [
    {
      "segmentNumber": 1,
      "duration": 60,
      "startTime": "00:00:00",
      "endTime": "00:01:00"
    }
  ]
}
```

#### Download Recording
```http
GET /api/recordings/{botId}/download
```

Returns the recording file as a binary download.

### Webhook Events

Configure webhook URL to receive real-time bot status updates:

```http
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://your-app.com/webhook/meetingbot",
  "events": ["bot.started", "bot.joined", "bot.recording", "bot.completed", "bot.failed"],
  "secret": "your-webhook-secret"
}
```

**Webhook Payload Example:**
```json
{
  "event": "bot.recording",
  "botId": "bot_123456",
  "timestamp": "2025-07-29T12:01:00Z",
  "data": {
    "participantCount": 3,
    "recordingDuration": 60,
    "status": "recording"
  }
}
```

## Implementation

### 1. Create Bot Manager API Server

Create `src/api/server.js`:

```javascript
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());

// In-memory storage (use database in production)
const activeBots = new Map();
const botHistory = new Map();

// Launch Bot Endpoint
app.post('/api/bots', async (req, res) => {
  try {
    const {
      meetingUrl,
      platform,
      botDisplayName = 'RecordingBot',
      userId,
      meetingTitle,
      automaticLeave = {
        waitingRoomTimeout: 60000,
        noOneJoinedTimeout: 300000,
        everyoneLeftTimeout: 60000
      },
      recordingSettings = {
        format: 'mp3',
        segmentDuration: 60,
        quality: 'medium'
      }
    } = req.body;

    // Validate required fields
    if (!meetingUrl || !platform || !userId) {
      return res.status(400).json({
        error: 'Missing required fields: meetingUrl, platform, userId'
      });
    }

    // Generate unique bot ID
    const botId = `bot_${uuidv4()}`;
    
    // Create bot configuration
    const botConfig = {
      id: botId,
      userId,
      meetingInfo: {
        meetingUrl,
        platform
      },
      meetingTitle: meetingTitle || 'Meeting Recording',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour default
      botDisplayName,
      heartbeatInterval: 5000,
      automaticLeave,
      recordingSettings
    };

    // Store bot info
    activeBots.set(botId, {
      ...botConfig,
      status: 'launching',
      createdAt: new Date(),
      pid: null
    });

    // Launch bot process
    const botProcess = spawn('node', ['-r', 'tsx/cjs', 'src/index.ts'], {
      cwd: path.join(__dirname, '../bots'),
      env: {
        ...process.env,
        BOT_DATA: JSON.stringify(botConfig),
        AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,
        AWS_REGION: process.env.AWS_REGION,
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        NODE_ENV: 'production'
      }
    });

    // Update bot info with process ID
    const botInfo = activeBots.get(botId);
    botInfo.pid = botProcess.pid;
    botInfo.status = 'starting';

    // Handle process events
    botProcess.on('exit', (code) => {
      const bot = activeBots.get(botId);
      if (bot) {
        bot.status = code === 0 ? 'completed' : 'failed';
        bot.completedAt = new Date();
        botHistory.set(botId, bot);
        activeBots.delete(botId);
      }
    });

    // Stream bot output (optional, for debugging)
    botProcess.stdout.on('data', (data) => {
      console.log(`Bot ${botId}: ${data}`);
    });

    botProcess.stderr.on('data', (data) => {
      console.error(`Bot ${botId} error: ${data}`);
    });

    res.status(201).json({
      botId,
      status: 'launching',
      meetingUrl,
      platform,
      createdAt: botInfo.createdAt,
      estimatedStartTime: new Date(Date.now() + 30000) // 30 seconds
    });

  } catch (error) {
    console.error('Error launching bot:', error);
    res.status(500).json({ error: 'Failed to launch bot' });
  }
});

// Get Bot Status
app.get('/api/bots/:botId', (req, res) => {
  const { botId } = req.params;
  
  const bot = activeBots.get(botId) || botHistory.get(botId);
  
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  res.json({
    botId,
    status: bot.status,
    meetingUrl: bot.meetingInfo.meetingUrl,
    platform: bot.meetingInfo.platform,
    meetingTitle: bot.meetingTitle,
    createdAt: bot.createdAt,
    startedAt: bot.startedAt,
    completedAt: bot.completedAt,
    lastHeartbeat: bot.lastHeartbeat
  });
});

// List Bots
app.get('/api/bots', (req, res) => {
  const { status, userId, limit = 50, offset = 0 } = req.query;
  
  let bots = [...activeBots.values(), ...botHistory.values()];
  
  // Filter by status
  if (status) {
    bots = bots.filter(bot => bot.status === status);
  }
  
  // Filter by userId
  if (userId) {
    bots = bots.filter(bot => bot.userId === userId);
  }
  
  // Paginate
  const total = bots.length;
  bots = bots.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  
  res.json({
    bots: bots.map(bot => ({
      botId: bot.id,
      status: bot.status,
      meetingTitle: bot.meetingTitle,
      platform: bot.meetingInfo.platform,
      createdAt: bot.createdAt
    })),
    total,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
});

// Stop Bot
app.delete('/api/bots/:botId', (req, res) => {
  const { botId } = req.params;
  
  const bot = activeBots.get(botId);
  
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found or already stopped' });
  }

  if (bot.pid) {
    process.kill(bot.pid, 'SIGTERM');
    bot.status = 'stopping';
  }

  res.json({
    botId,
    status: 'stopping',
    message: 'Bot stop initiated. Recording will be finalized and uploaded.'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot Manager API server running on port ${PORT}`);
});
```

### 2. Create Bot Manager Service

Create `src/api/bot-manager.js`:

```javascript
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');

class BotManager extends EventEmitter {
  constructor() {
    super();
    this.activeBots = new Map();
    this.botHistory = new Map();
  }

  async launchBot(config) {
    const botId = config.id;
    
    // Store bot configuration
    const botInfo = {
      ...config,
      status: 'launching',
      createdAt: new Date(),
      pid: null
    };
    
    this.activeBots.set(botId, botInfo);

    try {
      // Launch bot process
      const botProcess = spawn('tsx', ['src/index.ts'], {
        cwd: path.join(__dirname, '../bots'),
        env: {
          ...process.env,
          BOT_DATA: JSON.stringify(config),
          NODE_ENV: 'production'
        }
      });

      // Update with process ID
      botInfo.pid = botProcess.pid;
      botInfo.status = 'starting';
      
      this.emit('bot.started', { botId, pid: botProcess.pid });

      // Handle process events
      botProcess.on('exit', (code, signal) => {
        const bot = this.activeBots.get(botId);
        if (bot) {
          bot.status = code === 0 ? 'completed' : 'failed';
          bot.completedAt = new Date();
          bot.exitCode = code;
          bot.signal = signal;
          
          this.botHistory.set(botId, bot);
          this.activeBots.delete(botId);
          
          this.emit('bot.completed', { botId, code, signal });
        }
      });

      // Monitor bot output for status updates
      botProcess.stdout.on('data', (data) => {
        this.handleBotOutput(botId, data.toString());
      });

      botProcess.stderr.on('data', (data) => {
        this.handleBotError(botId, data.toString());
      });

      return { success: true, botId, pid: botProcess.pid };
      
    } catch (error) {
      botInfo.status = 'failed';
      botInfo.error = error.message;
      this.emit('bot.failed', { botId, error: error.message });
      throw error;
    }
  }

  handleBotOutput(botId, output) {
    const bot = this.activeBots.get(botId);
    if (!bot) return;

    // Parse bot status from output
    if (output.includes('Joined Call')) {
      bot.status = 'joined';
      bot.joinedAt = new Date();
      this.emit('bot.joined', { botId });
    } else if (output.includes('Recording Started')) {
      bot.status = 'recording';
      bot.recordingStartedAt = new Date();
      this.emit('bot.recording', { botId });
    } else if (output.includes('Updated Participant Count:')) {
      const match = output.match(/Updated Participant Count: (\d+)/);
      if (match) {
        bot.participantCount = parseInt(match[1]);
        this.emit('bot.participants', { botId, count: bot.participantCount });
      }
    }

    bot.lastHeartbeat = new Date();
  }

  handleBotError(botId, error) {
    console.error(`Bot ${botId} error:`, error);
    this.emit('bot.error', { botId, error });
  }

  stopBot(botId) {
    const bot = this.activeBots.get(botId);
    if (!bot || !bot.pid) {
      throw new Error('Bot not found or already stopped');
    }

    process.kill(bot.pid, 'SIGTERM');
    bot.status = 'stopping';
    bot.stoppedAt = new Date();
    
    this.emit('bot.stopping', { botId });
    return true;
  }

  getBotStatus(botId) {
    return this.activeBots.get(botId) || this.botHistory.get(botId);
  }

  listBots(filters = {}) {
    let bots = [...this.activeBots.values(), ...this.botHistory.values()];
    
    if (filters.status) {
      bots = bots.filter(bot => bot.status === filters.status);
    }
    
    if (filters.userId) {
      bots = bots.filter(bot => bot.userId === filters.userId);
    }
    
    return bots;
  }

  getActiveBotCount() {
    return this.activeBots.size;
  }
}

module.exports = BotManager;
```

### 3. Update Package.json

Add API server scripts to `package.json`:

```json
{
  "scripts": {
    "api:dev": "nodemon src/api/server.js",
    "api:start": "node src/api/server.js",
    "bot:single": "tsx src/bots/src/index.ts"
  },
  "dependencies": {
    "express": "^4.18.2",
    "uuid": "^9.0.0",
    "nodemon": "^3.0.1"
  }
}
```

## Usage Examples

### Node.js Client

```javascript
const axios = require('axios');

class MeetingBotClient {
  constructor(baseURL = 'http://localhost:3000') {
    this.api = axios.create({ baseURL });
  }

  async launchBot(config) {
    const response = await this.api.post('/api/bots', config);
    return response.data;
  }

  async getBotStatus(botId) {
    const response = await this.api.get(`/api/bots/${botId}`);
    return response.data;
  }

  async stopBot(botId) {
    const response = await this.api.delete(`/api/bots/${botId}`);
    return response.data;
  }

  async listBots(filters = {}) {
    const response = await this.api.get('/api/bots', { params: filters });
    return response.data;
  }
}

// Usage
const client = new MeetingBotClient();

// Launch multiple bots
const meetings = [
  'https://meet.google.com/abc-defg-hij',
  'https://meet.google.com/klm-nopq-rst',
  'https://meet.google.com/uvw-xyza-bcd'
];

const bots = await Promise.all(
  meetings.map(url => client.launchBot({
    meetingUrl: url,
    platform: 'google',
    userId: 'user123',
    meetingTitle: `Meeting ${url.split('/').pop()}`
  }))
);

console.log('Launched bots:', bots.map(b => b.botId));
```

### Python Client

```python
import requests
import json

class MeetingBotClient:
    def __init__(self, base_url="http://localhost:3000"):
        self.base_url = base_url

    def launch_bot(self, config):
        response = requests.post(f"{self.base_url}/api/bots", json=config)
        return response.json()

    def get_bot_status(self, bot_id):
        response = requests.get(f"{self.base_url}/api/bots/{bot_id}")
        return response.json()

    def stop_bot(self, bot_id):
        response = requests.delete(f"{self.base_url}/api/bots/{bot_id}")
        return response.json()

    def list_bots(self, **filters):
        response = requests.get(f"{self.base_url}/api/bots", params=filters)
        return response.json()

# Usage
client = MeetingBotClient()

# Launch bot
bot = client.launch_bot({
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "platform": "google",
    "userId": "user123",
    "meetingTitle": "Daily Standup"
})

print(f"Bot launched: {bot['botId']}")
```

## Deployment

### Docker Compose Setup

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  bot-manager:
    build: 
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/meetingbot
      - AWS_BUCKET_NAME=my-meetingbot-recordings
      - AWS_REGION=us-east-1
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
    depends_on:
      - postgres
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=meetingbot
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

### Kubernetes Deployment

Create `k8s/bot-manager.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bot-manager
spec:
  replicas: 2
  selector:
    matchLabels:
      app: bot-manager
  template:
    metadata:
      labels:
        app: bot-manager
    spec:
      containers:
      - name: bot-manager
        image: meetingbot/api:latest
        ports:
        - containerPort: 3000
        env:
        - name: AWS_BUCKET_NAME
          value: "my-meetingbot-recordings"
        - name: AWS_REGION
          value: "us-east-1"
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: aws-credentials
              key: access-key-id
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: aws-credentials
              key: secret-access-key
---
apiVersion: v1
kind: Service
metadata:
  name: bot-manager-service
spec:
  selector:
    app: bot-manager
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Monitoring and Observability

### Health Checks

```javascript
// Add to server.js
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeBots: activeBots.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});
```

### Metrics Endpoint

```javascript
app.get('/metrics', (req, res) => {
  const metrics = {
    active_bots: activeBots.size,
    total_bots_launched: botHistory.size + activeBots.size,
    bots_by_status: {},
    memory_usage: process.memoryUsage(),
    uptime_seconds: process.uptime()
  };

  // Count bots by status
  [...activeBots.values(), ...botHistory.values()].forEach(bot => {
    metrics.bots_by_status[bot.status] = (metrics.bots_by_status[bot.status] || 0) + 1;
  });

  res.json(metrics);
});
```

This API-based system allows you to:

1. **Launch multiple bots simultaneously** through API calls
2. **Monitor bot status** in real-time
3. **Scale horizontally** by running multiple API servers
4. **Integrate with existing applications** using REST APIs
5. **Track recordings** and manage storage
6. **Set up monitoring and alerts** for bot health

The system replaces environment variable configuration with dynamic API-driven bot management, making it much more flexible and scalable for production use.
