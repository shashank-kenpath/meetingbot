#!/usr/bin/env node

/**
 * MeetingBot API Client Example
 * 
 * This script demonstrates how to use the MeetingBot API to launch and manage multiple bots.
 * 
 * Usage:
 *   node client-example.js
 * 
 * Environment variables:
 *   MEETINGBOT_API_URL - API server URL (default: http://localhost:3000)
 */

const axios = require('axios');

class MeetingBotClient {
  constructor(baseURL = process.env.MEETINGBOT_API_URL || 'http://localhost:3000') {
    this.api = axios.create({ 
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`📡 MeetingBot API Client connected to: ${baseURL}`);
  }

  async launchBot(config) {
    try {
      const response = await this.api.post('/api/bots', config);
      console.log(`🚀 Bot launched:`, response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to launch bot:', error.response?.data || error.message);
      throw error;
    }
  }

  async getBotStatus(botId) {
    try {
      const response = await this.api.get(`/api/bots/${botId}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to get bot status for ${botId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getBotLogs(botId, limit = 50) {
    try {
      const response = await this.api.get(`/api/bots/${botId}/logs?limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to get bot logs for ${botId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async listBots(filters = {}) {
    try {
      const response = await this.api.get('/api/bots', { params: filters });
      return response.data;
    } catch (error) {
      console.error('❌ Failed to list bots:', error.response?.data || error.message);
      throw error;
    }
  }

  async stopBot(botId) {
    try {
      const response = await this.api.delete(`/api/bots/${botId}`);
      console.log(`🛑 Bot stopped:`, response.data);
      return response.data;
    } catch (error) {
      console.error(`❌ Failed to stop bot ${botId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  async getStats() {
    try {
      const response = await this.api.get('/api/stats');
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get stats:', error.response?.data || error.message);
      throw error;
    }
  }

  async healthCheck() {
    try {
      const response = await this.api.get('/health');
      return response.data;
    } catch (error) {
      console.error('❌ Health check failed:', error.response?.data || error.message);
      throw error;
    }
  }

  // Helper method to wait for bot to reach a specific status
  async waitForBotStatus(botId, targetStatus, timeoutMs = 60000, pollIntervalMs = 2000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const bot = await this.getBotStatus(botId);
        
        if (bot.status === targetStatus) {
          return bot;
        }
        
        if (bot.status === 'failed') {
          throw new Error(`Bot ${botId} failed to reach ${targetStatus}, current status: ${bot.status}`);
        }
        
        console.log(`⏳ Bot ${botId} status: ${bot.status}, waiting for ${targetStatus}...`);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        
      } catch (error) {
        if (error.response?.status === 404) {
          throw new Error(`Bot ${botId} not found`);
        }
        throw error;
      }
    }
    
    throw new Error(`Timeout waiting for bot ${botId} to reach status ${targetStatus}`);
  }

  // Monitor bot progress with real-time updates
  async monitorBot(botId, onUpdate, stopConditions = ['completed', 'failed']) {
    console.log(`👀 Monitoring bot ${botId}...`);
    
    let lastStatus = null;
    
    const checkStatus = async () => {
      try {
        const bot = await this.getBotStatus(botId);
        
        if (bot.status !== lastStatus) {
          console.log(`📊 Bot ${botId} status changed: ${lastStatus} → ${bot.status}`);
          lastStatus = bot.status;
          
          if (onUpdate) {
            onUpdate(bot);
          }
        }
        
        if (stopConditions.includes(bot.status)) {
          console.log(`🏁 Bot ${botId} monitoring complete. Final status: ${bot.status}`);
          return bot;
        }
        
        // Continue monitoring
        setTimeout(checkStatus, 2000);
        
      } catch (error) {
        console.error(`❌ Error monitoring bot ${botId}:`, error.message);
      }
    };
    
    return checkStatus();
  }
}

// Example usage functions
async function basicExample() {
  console.log('\n🔹 Basic Example: Launch and monitor a single bot');
  
  const client = new MeetingBotClient();
  
  // Health check
  const health = await client.healthCheck();
  console.log('💚 API Health:', health);
  
  // Launch a bot
  const bot = await client.launchBot({
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    platform: 'google',
    userId: 'demo-user',
    meetingTitle: 'Demo Meeting',
    botDisplayName: 'DemoBot'
  });
  
  // Monitor the bot
  await client.monitorBot(bot.botId, (botStatus) => {
    console.log(`📈 Bot Update: ${botStatus.status} - Participants: ${botStatus.participantCount}`);
  });
}

async function multipleBotsExample() {
  console.log('\n🔹 Multiple Bots Example: Launch several bots simultaneously');
  
  const client = new MeetingBotClient();
  
  const meetings = [
    {
      meetingUrl: 'https://meet.google.com/meeting-1',
      platform: 'google',
      userId: 'user1',
      meetingTitle: 'Team Standup',
      botDisplayName: 'StandupBot'
    },
    {
      meetingUrl: 'https://meet.google.com/meeting-2', 
      platform: 'google',
      userId: 'user2',
      meetingTitle: 'Project Review',
      botDisplayName: 'ReviewBot'
    },
    {
      meetingUrl: 'https://meet.google.com/meeting-3',
      platform: 'google', 
      userId: 'user3',
      meetingTitle: 'Client Demo',
      botDisplayName: 'DemoBot'
    }
  ];
  
  // Launch all bots
  console.log(`🚀 Launching ${meetings.length} bots...`);
  const launchedBots = await Promise.all(
    meetings.map(meeting => client.launchBot(meeting))
  );
  
  console.log(`✅ Launched ${launchedBots.length} bots:`, 
    launchedBots.map(b => b.botId));
  
  // Monitor all bots
  const monitorPromises = launchedBots.map(bot => 
    client.monitorBot(bot.botId, (status) => {
      console.log(`📊 ${bot.botId}: ${status.status} (${status.participantCount} participants)`);
    })
  );
  
  // Wait for all bots to complete
  const results = await Promise.allSettled(monitorPromises);
  console.log('🏁 All bots completed:', results);
}

async function managementExample() {
  console.log('\n🔹 Management Example: List, monitor, and stop bots');
  
  const client = new MeetingBotClient();
  
  // Get system stats
  const stats = await client.getStats();
  console.log('📊 System Stats:', stats);
  
  // List all active bots
  const activeBotsResponse = await client.listBots({ status: 'recording' });
  console.log(`🤖 Active recording bots: ${activeBotsResponse.total}`);
  
  if (activeBotsResponse.bots.length > 0) {
    // Show details of first active bot
    const firstBot = activeBotsResponse.bots[0];
    console.log('📋 First active bot details:', firstBot);
    
    // Get logs for the bot
    const logs = await client.getBotLogs(firstBot.botId, 10);
    console.log(`📜 Recent logs for ${firstBot.botId}:`, logs.logs);
    
    // Optionally stop the bot (uncomment to test)
    // await client.stopBot(firstBot.botId);
  }
  
  // List all bots (with pagination)
  const allBotsResponse = await client.listBots({ limit: 10, offset: 0 });
  console.log(`📋 Total bots: ${allBotsResponse.total}, showing ${allBotsResponse.bots.length}`);
}

// Main execution
async function main() {
  console.log('🤖 MeetingBot API Client Example\n');
  
  try {
    // Choose which example to run
    const example = process.argv[2] || 'basic';
    
    switch (example) {
      case 'basic':
        await basicExample();
        break;
      case 'multiple':
        await multipleBotsExample();
        break;
      case 'management':
        await managementExample();
        break;
      default:
        console.log(`❓ Unknown example: ${example}`);
        console.log('Available examples: basic, multiple, management');
        console.log('Usage: node client-example.js [basic|multiple|management]');
        process.exit(1);
    }
    
    console.log('\n✅ Example completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Example failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = MeetingBotClient;
