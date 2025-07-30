#!/usr/bin/env bash

# Helper script to check LocalStack S3 bucket contents

echo "📦 LocalStack S3 Bucket Contents:"
echo "=================================="

# Check if LocalStack is running
if ! docker ps --filter "name=localstack" | grep -q localstack; then
  echo "❌ LocalStack is not running. Start it with: ./run-local.sh"
  exit 1
fi

# Set LocalStack credentials
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=us-east-1

# List bucket contents
echo "Bucket: my-bucket"
aws --endpoint-url=http://localhost:4566 s3 ls s3://my-bucket --recursive

echo ""
echo "📋 To download a file:"
echo "aws --endpoint-url=http://localhost:4566 s3 cp s3://my-bucket/filename.mp4 ./"

echo ""
echo "🗑️  To delete all files:"
echo "aws --endpoint-url=http://localhost:4566 s3 rm s3://my-bucket --recursive"
