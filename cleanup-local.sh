#!/usr/bin/env bash

echo "Stopping LocalStack..."
docker stop localstack
docker rm localstack

echo "✅ LocalStack stopped and removed"
echo "🧹 Local development environment cleaned up"
