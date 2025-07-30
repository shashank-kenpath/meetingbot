# AWS S3 Setup for MeetingBot

This guide explains how to configure MeetingBot to save recordings to AWS S3 buckets instead of local storage.

## Prerequisites

- AWS Account with S3 access
- AWS CLI installed and configured
- IAM user with appropriate S3 permissions

## Step 1: Create S3 Bucket

### Using AWS Console:
1. Login to AWS Console
2. Navigate to S3 service
3. Click "Create bucket"
4. Choose a unique bucket name (e.g., `my-meetingbot-recordings`)
5. Select your preferred region
6. Configure bucket settings as needed
7. Click "Create bucket"

### Using AWS CLI:
```bash
# Create bucket
aws s3 mb s3://my-meetingbot-recordings --region us-east-1

# Enable versioning (optional)
aws s3api put-bucket-versioning \
    --bucket my-meetingbot-recordings \
    --versioning-configuration Status=Enabled
```

## Step 2: Create IAM User and Permissions

### Create IAM Policy

Create a file `meetingbot-s3-policy.json`:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::my-meetingbot-recordings",
                "arn:aws:s3:::my-meetingbot-recordings/*"
            ]
        }
    ]
}
```

### Create IAM User:
```bash
# Create IAM user
aws iam create-user --user-name meetingbot-user

# Create policy
aws iam create-policy \
    --policy-name MeetingBotS3Policy \
    --policy-document file://meetingbot-s3-policy.json

# Attach policy to user
aws iam attach-user-policy \
    --user-name meetingbot-user \
    --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/MeetingBotS3Policy

# Create access keys
aws iam create-access-key --user-name meetingbot-user
```

## Step 3: Configure Environment Variables

### For Local Development (.env.local):
```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
AWS_BUCKET_NAME=my-meetingbot-recordings

# Remove or comment out LocalStack endpoint
# AWS_ENDPOINT=http://localhost:4566
```

### For Server Deployment (src/server/.env):
```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
AWS_BUCKET_NAME=my-meetingbot-recordings

# Database
DATABASE_URL="postgresql://user:password@host:5432/database"

# Other server configs...
```

### For Bot Service (src/bots/.env):
```bash
# AWS Configuration
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
AWS_BUCKET_NAME=my-meetingbot-recordings

# Environment
NODE_ENV=production
```

## Step 4: Verify S3 Connection

Test your S3 connection:

```bash
# Test listing bucket contents
aws s3 ls s3://my-meetingbot-recordings

# Test uploading a file
echo "test" > test.txt
aws s3 cp test.txt s3://my-meetingbot-recordings/
aws s3 ls s3://my-meetingbot-recordings/
aws s3 rm s3://my-meetingbot-recordings/test.txt
rm test.txt
```

## Step 5: Production Deployment Considerations

### Bucket Lifecycle Policies
Configure automatic cleanup of old recordings:

```json
{
    "Rules": [
        {
            "ID": "DeleteOldRecordings",
            "Status": "Enabled",
            "Transitions": [
                {
                    "Days": 30,
                    "StorageClass": "STANDARD_IA"
                },
                {
                    "Days": 90,
                    "StorageClass": "GLACIER"
                }
            ],
            "Expiration": {
                "Days": 365
            }
        }
    ]
}
```

Apply lifecycle policy:
```bash
aws s3api put-bucket-lifecycle-configuration \
    --bucket my-meetingbot-recordings \
    --lifecycle-configuration file://lifecycle.json
```

### Bucket Encryption
Enable server-side encryption:

```bash
aws s3api put-bucket-encryption \
    --bucket my-meetingbot-recordings \
    --server-side-encryption-configuration '{
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }
        ]
    }'
```

### Cross-Region Replication (Optional)
For backup and disaster recovery:

```bash
# Create replication bucket in different region
aws s3 mb s3://my-meetingbot-recordings-backup --region us-west-2

# Configure replication (requires additional IAM role setup)
# See AWS documentation for detailed steps
```

## Monitoring and Alerts

### CloudWatch Metrics
Monitor S3 usage and costs:

```bash
# Get bucket size
aws cloudwatch get-metric-statistics \
    --namespace AWS/S3 \
    --metric-name BucketSizeBytes \
    --dimensions Name=BucketName,Value=my-meetingbot-recordings Name=StorageType,Value=StandardStorage \
    --statistics Average \
    --start-time 2025-07-28T00:00:00Z \
    --end-time 2025-07-29T00:00:00Z \
    --period 86400
```

### Cost Optimization Tips

1. **Use appropriate storage classes**: Move old recordings to cheaper storage
2. **Implement compression**: Use ffmpeg compression settings to reduce file sizes
3. **Monitor access patterns**: Use S3 analytics to optimize storage classes
4. **Set up billing alerts**: Get notified when costs exceed thresholds

## Troubleshooting

### Common Issues:

1. **Access Denied Error**:
   - Check IAM permissions
   - Verify bucket policy
   - Ensure correct region

2. **Upload Failures**:
   - Check network connectivity
   - Verify file permissions
   - Monitor CloudWatch logs

3. **High Costs**:
   - Review storage class usage
   - Check for failed uploads creating partial objects
   - Implement lifecycle policies

### Debug Commands:

```bash
# Check S3 configuration
aws s3api get-bucket-location --bucket my-meetingbot-recordings

# List all objects with metadata
aws s3api list-objects-v2 --bucket my-meetingbot-recordings

# Check bucket policy
aws s3api get-bucket-policy --bucket my-meetingbot-recordings

# Monitor S3 access logs (if enabled)
aws s3 ls s3://my-access-logs-bucket/
```

## Security Best Practices

1. **Use IAM roles instead of access keys** when running on EC2
2. **Enable MFA for sensitive operations**
3. **Regularly rotate access keys**
4. **Use VPC endpoints** for private network access to S3
5. **Enable CloudTrail** for audit logging
6. **Implement bucket policies** for additional access control

## Next Steps

- Set up automated backups
- Configure monitoring and alerting
- Implement data retention policies
- Set up cross-region replication for disaster recovery
