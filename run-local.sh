#!/usr/bin/env bash
set -e

# 1. Start LocalStack (S3 emulator)
if ! docker ps --filter "name=localstack" | grep -q localstack; then
  echo "Starting LocalStack..."
  docker run -d --name localstack -p 4566:4566 localstack/localstack
else
  echo "LocalStack is already running"
fi

# 2. Wait for S3 to be ready
echo "Waiting for LocalStack to be ready..."
timeout=60
counter=0
until curl -s http://localhost:4566/_localstack/health | grep -q "s3" && curl -s http://localhost:4566 > /dev/null 2>&1; do
  if [ $counter -ge $timeout ]; then
    echo "Timeout waiting for LocalStack to start. Check container logs:"
    docker logs localstack
    exit 1
  fi
  echo "Waiting... ($counter/$timeout)"
  sleep 3
  counter=$((counter + 3))
done
echo "LocalStack is ready!"

# 3. Create S3 bucket if not exists
BUCKET=my-bucket
echo "Creating S3 bucket '$BUCKET'..."
# Wait a bit more for LocalStack to fully initialize
sleep 3
aws --endpoint-url=http://localhost:4566 s3 mb s3://$BUCKET 2>/dev/null || echo "Bucket may already exist"

# 4. Export environment variables
export AWS_ENDPOINT=http://localhost:4566
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=us-east-1
export AWS_BUCKET_NAME=$BUCKET
export NODE_ENV=development

# 5. BOT_DATA: edit or provide via .env.local
if [ -f .env.local ]; then
  echo "Loading .env.local..."
  # Source the .env.local file directly to handle JSON properly
  set -a  # automatically export all variables
  source .env.local
  set +a  # turn off automatic export
else
  echo "\n*** WARNING ***"
  echo "No .env.local found, using placeholder BOT_DATA. Update BOT_DATA in this script or create a .env.local file."
  export BOT_DATA='{"id":1,"userId":"user1","meetingInfo":{"meetingUrl":"https://example.com","platform":"zoom"},"meetingTitle":"Local Demo","startTime":"2025-07-29T10:00:00.000Z","endTime":"2025-07-29T11:00:00.000Z","botDisplayName":"DemoBot","heartbeatInterval":5000,"automaticLeave":{"waitingRoomTimeout":60000,"noOneJoinedTimeout":60000,"everyoneLeftTimeout":60000}}'
fi

# 6. Install dependencies
echo "Installing dependencies..."

# Check if pnpm is available, if not install it
if ! command -v pnpm &> /dev/null; then
  echo "pnpm not found, installing..."
  npm install -g pnpm
fi

pnpm install -r

# 7. Run the bot
echo "Starting MeetingBot..."
cd src/bots
pnpm run start
