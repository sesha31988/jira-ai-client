
# Jira AI Client POC

## Setup

1. Install dependencies:
   npm install

2. Copy .env.example to .env and update values.

3. Start server:
   npm start

## Configure Jira Webhook

Settings → System → Webhooks
URL: http://your-server-ip:3000/jira-webhook
Event: Issue Created

This POC:
- Receives Jira webhook
- Uses OpenAI to analyze ticket
- Searches similar issues
- Adds AI comment to ticket
