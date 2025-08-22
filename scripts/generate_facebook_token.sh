#!/bin/bash

echo "🔑 Facebook Long-Lived Token Generator"
echo "====================================="

# Check if curl is available
if ! command -v curl &> /dev/null; then
    echo "❌ curl is required but not installed. Please install curl first."
    exit 1
fi

# Prompt for required information
echo ""
echo "Please provide the following information from Facebook Developers Console:"
echo "(Visit: https://developers.facebook.com/apps/)"
echo ""

read -p "📱 App ID: " APP_ID
if [[ -z "$APP_ID" ]]; then
    echo "❌ App ID is required"
    exit 1
fi

read -s -p "🔐 App Secret: " APP_SECRET
echo ""
if [[ -z "$APP_SECRET" ]]; then
    echo "❌ App Secret is required"
    exit 1
fi

read -s -p "🎫 Short-lived User Access Token: " SHORT_TOKEN
echo ""
if [[ -z "$SHORT_TOKEN" ]]; then
    echo "❌ Short-lived token is required"
    exit 1
fi

echo ""
echo "🚀 Generating long-lived token..."
echo ""

# Make the API call
RESPONSE=$(curl -s -X GET "https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${SHORT_TOKEN}")

# Check if response contains access_token
if echo "$RESPONSE" | grep -q "access_token"; then
    echo "✅ Success! Long-lived token generated:"
    echo ""
    
    # Pretty print the response
    echo "$RESPONSE" | sed 's/,/,\n/g' | sed 's/{/{\n/g' | sed 's/}/\n}/g'
    
    echo ""
    echo "📝 Extract the access_token value and update your .env file:"
    echo "LONG_LIVED_TOKEN=<the-long-access-token-from-above>"
    echo ""
    echo "⏱️ This token is valid for approximately 60 days."
    
else
    echo "❌ Error occurred:"
    echo "$RESPONSE"
    echo ""
    echo "Common issues:"
    echo "• Make sure your short-lived token is valid and not expired"
    echo "• Verify your App ID and App Secret are correct"
    echo "• Check that your Facebook app has the necessary permissions"
fi

echo ""
echo "🔗 Useful links:"
echo "• Facebook Developers Console: https://developers.facebook.com/apps/"
echo "• Graph API Explorer: https://developers.facebook.com/tools/explorer/"
echo "• Access Token Debugger: https://developers.facebook.com/tools/debug/accesstoken/"
