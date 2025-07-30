const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// In-memory storage (use database in production)
const activeBots = new Map();
const botHistory = new Map();

// Bot status tracking
const BOT_STATUS = {
  LAUNCHING: 'launching',
  STARTING: 'starting',
  WAITING: 'waiting',
  JOINED: 'joined',
  RECORDING: 'recording',
  STOPPING: 'stopping',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

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
        error: 'Missing required fields: meetingUrl, platform, userId',
        required: ['meetingUrl', 'platform', 'userId']
      });
    }

    // Validate platform
    if (!['google', 'zoom', 'teams'].includes(platform)) {
      return res.status(400).json({
        error: 'Invalid platform. Must be one of: google, zoom, teams'
      });
    }

    // Generate unique bot ID
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create bot configuration
    const botConfig = {
      id: botId,
      userId,
      meetingInfo: {
        meetingUrl,
        platform
      },
      meetingTitle: meetingTitle || `Meeting Recording ${new Date().toLocaleString()}`,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour default
      botDisplayName,
      heartbeatInterval: 5000,
      automaticLeave,
      recordingSettings
    };

    // Store bot info
    const botInfo = {
      ...botConfig,
      status: BOT_STATUS.LAUNCHING,
      createdAt: new Date(),
      pid: null,
      logs: [],
      participantCount: 0,
      recordingDuration: 0
    };

    activeBots.set(botId, botInfo);

    // Launch bot process
    const botProcess = spawn('tsx', ['src/index.ts'], {
      cwd: path.join(__dirname, '../bots'),
      env: {
        ...process.env,
        BOT_DATA: JSON.stringify(botConfig),
        AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME || 'my-bucket',
        AWS_REGION: process.env.AWS_REGION || 'us-east-1',
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'test',
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        AWS_ENDPOINT: process.env.AWS_ENDPOINT || 'http://localhost:4566',
        NODE_ENV: process.env.NODE_ENV || 'development'
      }
    });

    // Update bot info with process ID
    botInfo.pid = botProcess.pid;
    botInfo.status = BOT_STATUS.STARTING;
    botInfo.startedAt = new Date();

    console.log(`🚀 Launched bot ${botId} with PID ${botProcess.pid} for ${meetingUrl}`);

    // Handle process events
    botProcess.on('exit', (code, signal) => {
      const bot = activeBots.get(botId);
      if (bot) {
        bot.status = code === 0 ? BOT_STATUS.COMPLETED : BOT_STATUS.FAILED;
        bot.completedAt = new Date();
        bot.exitCode = code;
        bot.signal = signal;
        
        console.log(`🏁 Bot ${botId} completed with code ${code}`);
        
        // Move to history
        botHistory.set(botId, bot);
        activeBots.delete(botId);
      }
    });

    // Stream bot output and parse status
    botProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const bot = activeBots.get(botId);
      
      if (bot) {
        // Add to logs
        bot.logs.push({
          timestamp: new Date(),
          type: 'stdout',
          message: output.trim()
        });

        // Parse status from output
        if (output.includes('Awaiting Entry')) {
          bot.status = BOT_STATUS.WAITING;
        } else if (output.includes('Joined Call')) {
          bot.status = BOT_STATUS.JOINED;
          bot.joinedAt = new Date();
        } else if (output.includes('Recording Started') || output.includes('Recording segment')) {
          bot.status = BOT_STATUS.RECORDING;
          if (!bot.recordingStartedAt) {
            bot.recordingStartedAt = new Date();
          }
        } else if (output.includes('Updated Participant Count:')) {
          const match = output.match(/Updated Participant Count: (\d+)/);
          if (match) {
            bot.participantCount = parseInt(match[1]);
          }
        }

        bot.lastHeartbeat = new Date();
      }

      console.log(`📟 Bot ${botId}: ${output.trim()}`);
    });

    botProcess.stderr.on('data', (data) => {
      const error = data.toString();
      const bot = activeBots.get(botId);
      
      if (bot) {
        bot.logs.push({
          timestamp: new Date(),
          type: 'stderr',
          message: error.trim()
        });
      }

      console.error(`❌ Bot ${botId} error: ${error.trim()}`);
    });

    res.status(201).json({
      botId,
      status: BOT_STATUS.LAUNCHING,
      meetingUrl,
      platform,
      meetingTitle: botConfig.meetingTitle,
      createdAt: botInfo.createdAt,
      estimatedStartTime: new Date(Date.now() + 30000) // 30 seconds
    });

  } catch (error) {
    console.error('❌ Error launching bot:', error);
    res.status(500).json({ 
      error: 'Failed to launch bot',
      details: error.message 
    });
  }
});

// Get Bot Status
app.get('/api/bots/:botId', (req, res) => {
  const { botId } = req.params;
  
  const bot = activeBots.get(botId) || botHistory.get(botId);
  
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  // Calculate recording duration if recording
  let recordingDuration = 0;
  if (bot.recordingStartedAt) {
    const endTime = bot.completedAt || new Date();
    recordingDuration = Math.floor((endTime - bot.recordingStartedAt) / 1000);
  }

  res.json({
    botId,
    status: bot.status,
    meetingUrl: bot.meetingInfo.meetingUrl,
    platform: bot.meetingInfo.platform,
    meetingTitle: bot.meetingTitle,
    botDisplayName: bot.botDisplayName,
    userId: bot.userId,
    participantCount: bot.participantCount,
    recordingDuration,
    createdAt: bot.createdAt,
    startedAt: bot.startedAt,
    joinedAt: bot.joinedAt,
    recordingStartedAt: bot.recordingStartedAt,
    completedAt: bot.completedAt,
    lastHeartbeat: bot.lastHeartbeat,
    exitCode: bot.exitCode,
    pid: bot.pid
  });
});

// Get Bot Logs
app.get('/api/bots/:botId/logs', (req, res) => {
  const { botId } = req.params;
  const { limit = 100, type } = req.query;
  
  const bot = activeBots.get(botId) || botHistory.get(botId);
  
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  let logs = bot.logs || [];
  
  // Filter by type if specified
  if (type) {
    logs = logs.filter(log => log.type === type);
  }

  // Limit results
  logs = logs.slice(-parseInt(limit));

  res.json({
    botId,
    logs,
    total: logs.length
  });
});

// List Bots
app.get('/api/bots', (req, res) => {
  const { status, userId, platform, limit = 50, offset = 0 } = req.query;
  
  let bots = [...activeBots.values(), ...botHistory.values()];
  
  // Apply filters
  if (status) {
    bots = bots.filter(bot => bot.status === status);
  }
  
  if (userId) {
    bots = bots.filter(bot => bot.userId === userId);
  }

  if (platform) {
    bots = bots.filter(bot => bot.meetingInfo.platform === platform);
  }
  
  // Sort by creation time (newest first)
  bots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Paginate
  const total = bots.length;
  bots = bots.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  
  res.json({
    bots: bots.map(bot => ({
      botId: bot.id,
      status: bot.status,
      meetingTitle: bot.meetingTitle,
      meetingUrl: bot.meetingInfo.meetingUrl,
      platform: bot.meetingInfo.platform,
      userId: bot.userId,
      participantCount: bot.participantCount,
      createdAt: bot.createdAt,
      recordingStartedAt: bot.recordingStartedAt,
      completedAt: bot.completedAt
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
    try {
      process.kill(bot.pid, 'SIGTERM');
      bot.status = BOT_STATUS.STOPPING;
      bot.stoppedAt = new Date();
      
      console.log(`🛑 Stopping bot ${botId} (PID: ${bot.pid})`);
      
      res.json({
        botId,
        status: BOT_STATUS.STOPPING,
        message: 'Bot stop initiated. Recording will be finalized and uploaded.'
      });
    } catch (error) {
      console.error(`❌ Error stopping bot ${botId}:`, error);
      res.status(500).json({ 
        error: 'Failed to stop bot',
        details: error.message 
      });
    }
  } else {
    res.status(400).json({ error: 'Bot process not found' });
  }
});

// Get System Stats
app.get('/api/stats', (req, res) => {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const allBots = [...activeBots.values(), ...botHistory.values()];
  const recent24h = allBots.filter(bot => bot.createdAt >= last24h);
  
  const stats = {
    current: {
      activeBots: activeBots.size,
      totalBots: allBots.length
    },
    last24h: {
      launched: recent24h.length,
      completed: recent24h.filter(bot => bot.status === BOT_STATUS.COMPLETED).length,
      failed: recent24h.filter(bot => bot.status === BOT_STATUS.FAILED).length
    },
    byStatus: {},
    byPlatform: {},
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: now
    }
  };

  // Count by status
  allBots.forEach(bot => {
    stats.byStatus[bot.status] = (stats.byStatus[bot.status] || 0) + 1;
    stats.byPlatform[bot.meetingInfo.platform] = (stats.byPlatform[bot.meetingInfo.platform] || 0) + 1;
  });

  res.json(stats);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeBots: activeBots.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// Simple web interface
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>MeetingBot API Manager</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px; }
            .container { max-width: 1200px; margin: 0 auto; }
            .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
            .status.recording { background: #d4edda; color: #155724; }
            .status.waiting { background: #fff3cd; color: #856404; }
            .status.completed { background: #d1ecf1; color: #0c5460; }
            .status.failed { background: #f8d7da; color: #721c24; }
            button { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
            button:hover { background: #0056b3; }
            input, select { padding: 8px; margin: 4px; border: 1px solid #ccc; border-radius: 4px; }
            .form-group { margin: 10px 0; }
            label { display: block; margin-bottom: 4px; font-weight: bold; }
            .bot-list { display: grid; gap: 16px; }
            .bot-item { border: 1px solid #ddd; padding: 16px; border-radius: 8px; }
            .logs { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 MeetingBot API Manager</h1>
            
            <div class="card">
                <h2>Launch New Bot</h2>
                <form id="launchForm">
                    <div class="form-group">
                        <label>Meeting URL:</label>
                        <input type="url" id="meetingUrl" placeholder="https://meet.google.com/abc-defg-hij" required style="width: 400px;">
                    </div>
                    <div class="form-group">
                        <label>Platform:</label>
                        <select id="platform">
                            <option value="google">Google Meet</option>
                            <option value="zoom">Zoom</option>
                            <option value="teams">Microsoft Teams</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>User ID:</label>
                        <input type="text" id="userId" placeholder="user123" required>
                    </div>
                    <div class="form-group">
                        <label>Meeting Title:</label>
                        <input type="text" id="meetingTitle" placeholder="Project Standup">
                    </div>
                    <div class="form-group">
                        <label>Bot Display Name:</label>
                        <input type="text" id="botDisplayName" placeholder="RecordingBot" value="RecordingBot">
                    </div>
                    <button type="submit">🚀 Launch Bot</button>
                </form>
            </div>

            <div class="card">
                <h2>Active Bots</h2>
                <button onclick="refreshBots()">🔄 Refresh</button>
                <div id="botsList" class="bot-list"></div>
            </div>

            <div class="card">
                <h2>System Stats</h2>
                <div id="stats"></div>
            </div>
        </div>

        <script>
            let bots = [];

            async function launchBot(event) {
                event.preventDefault();
                
                const formData = {
                    meetingUrl: document.getElementById('meetingUrl').value,
                    platform: document.getElementById('platform').value,
                    userId: document.getElementById('userId').value,
                    meetingTitle: document.getElementById('meetingTitle').value || undefined,
                    botDisplayName: document.getElementById('botDisplayName').value || 'RecordingBot'
                };

                try {
                    const response = await fetch('/api/bots', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(formData)
                    });

                    const result = await response.json();
                    
                    if (response.ok) {
                        alert('Bot launched successfully! ID: ' + result.botId);
                        document.getElementById('launchForm').reset();
                        refreshBots();
                    } else {
                        alert('Error: ' + result.error);
                    }
                } catch (error) {
                    alert('Network error: ' + error.message);
                }
            }

            async function refreshBots() {
                try {
                    const response = await fetch('/api/bots?limit=20');
                    const data = await response.json();
                    bots = data.bots;
                    renderBots();
                } catch (error) {
                    console.error('Error fetching bots:', error);
                }
            }

            async function stopBot(botId) {
                if (!confirm('Are you sure you want to stop this bot?')) return;
                
                try {
                    const response = await fetch(\`/api/bots/\${botId}\`, { method: 'DELETE' });
                    const result = await response.json();
                    
                    if (response.ok) {
                        alert('Bot stop initiated');
                        refreshBots();
                    } else {
                        alert('Error: ' + result.error);
                    }
                } catch (error) {
                    alert('Network error: ' + error.message);
                }
            }

            function renderBots() {
                const container = document.getElementById('botsList');
                
                if (bots.length === 0) {
                    container.innerHTML = '<p>No bots found</p>';
                    return;
                }

                container.innerHTML = bots.map(bot => \`
                    <div class="bot-item">
                        <div style="display: flex; justify-content: between; align-items: center;">
                            <div style="flex: 1;">
                                <h3>\${bot.meetingTitle} <span class="status \${bot.status}">\${bot.status.toUpperCase()}</span></h3>
                                <p><strong>ID:</strong> \${bot.botId}</p>
                                <p><strong>Platform:</strong> \${bot.platform}</p>
                                <p><strong>URL:</strong> <a href="\${bot.meetingUrl}" target="_blank">\${bot.meetingUrl}</a></p>
                                <p><strong>User:</strong> \${bot.userId}</p>
                                <p><strong>Participants:</strong> \${bot.participantCount}</p>
                                <p><strong>Created:</strong> \${new Date(bot.createdAt).toLocaleString()}</p>
                                \${bot.recordingStartedAt ? \`<p><strong>Recording Since:</strong> \${new Date(bot.recordingStartedAt).toLocaleString()}</p>\` : ''}
                            </div>
                            <div>
                                \${bot.status === 'recording' || bot.status === 'waiting' || bot.status === 'joined' ? 
                                    \`<button onclick="stopBot('\${bot.botId}')" style="background: #dc3545;">🛑 Stop</button>\` : 
                                    ''
                                }
                            </div>
                        </div>
                    </div>
                \`).join('');
            }

            async function refreshStats() {
                try {
                    const response = await fetch('/api/stats');
                    const stats = await response.json();
                    
                    document.getElementById('stats').innerHTML = \`
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                            <div>
                                <h4>Current</h4>
                                <p>Active Bots: \${stats.current.activeBots}</p>
                                <p>Total Bots: \${stats.current.totalBots}</p>
                            </div>
                            <div>
                                <h4>Last 24h</h4>
                                <p>Launched: \${stats.last24h.launched}</p>
                                <p>Completed: \${stats.last24h.completed}</p>
                                <p>Failed: \${stats.last24h.failed}</p>
                            </div>
                            <div>
                                <h4>System</h4>
                                <p>Uptime: \${Math.floor(stats.system.uptime / 60)} minutes</p>
                                <p>Memory: \${Math.floor(stats.system.memory.rss / 1024 / 1024)} MB</p>
                            </div>
                        </div>
                    \`;
                } catch (error) {
                    console.error('Error fetching stats:', error);
                }
            }

            // Set up event listeners
            document.getElementById('launchForm').addEventListener('submit', launchBot);

            // Initial load
            refreshBots();
            refreshStats();

            // Auto-refresh every 5 seconds
            setInterval(() => {
                refreshBots();
                refreshStats();
            }, 5000);
        </script>
    </body>
    </html>
  `);
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 MeetingBot API Manager running on port ${PORT}

📖 API Endpoints:
   POST   /api/bots           - Launch new bot
   GET    /api/bots           - List all bots  
   GET    /api/bots/:id       - Get bot status
   GET    /api/bots/:id/logs  - Get bot logs
   DELETE /api/bots/:id       - Stop bot
   GET    /api/stats          - System statistics
   GET    /health             - Health check

🌐 Web Interface: http://localhost:${PORT}

📊 Current Status:
   Active Bots: ${activeBots.size}
   Total Bots: ${activeBots.size + botHistory.size}
  `);
});

module.exports = app;
