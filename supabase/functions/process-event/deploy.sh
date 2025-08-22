#!/bin/bash

# Deploy process-event Edge Function to Supabase
# Complete event processing system with enrichment capabilities

echo "🚀 Deploying process-event Edge Function..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first:"
    echo "npm install -g supabase"
    exit 1
fi

# Check if logged in to Supabase
if ! supabase status &> /dev/null; then
    echo "⚠️  Please login to Supabase CLI first:"
    echo "supabase login"
    exit 1
fi

# Deploy the function
echo "📦 Deploying Edge Function..."
supabase functions deploy process-event --project-ref $SUPABASE_PROJECT_REF

if [ $? -eq 0 ]; then
    echo "✅ process-event Edge Function deployed successfully!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Set environment variables in your Supabase dashboard:"
    echo "   - FACEBOOK_LONG_LIVED_TOKEN (required)"
    echo "   - GOOGLE_API_KEY (optional, for venue geocoding)"
    echo "   - OPENAI_API_KEY (optional, for AI descriptions)"  
    echo "   - SOUND_CLOUD_CLIENT_ID (optional, for artist enrichment)"
    echo "   - SOUND_CLOUD_CLIENT_SECRET (optional, for artist enrichment)"
    echo "   - LASTFM_API_KEY (optional, for genre classification)"
    echo ""
    echo "2. Test the function:"
    echo "   curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/process-event \\"
    echo "     -H 'Authorization: Bearer YOUR_ANON_KEY' \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -d '{\"eventId\": \"FACEBOOK_EVENT_ID\"}'"
    echo ""
    echo "🎉 Your comprehensive event processing system is now live!"
else
    echo "❌ Deployment failed. Please check the error messages above."
    exit 1
fi
