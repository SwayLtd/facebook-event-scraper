#!/bin/bash

# Test script for process-event Edge Function
# Tests the comprehensive event processing system

# Configuration - Update these values
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
TEST_FACEBOOK_EVENT_ID="123456789012345"  # Replace with real Facebook event ID

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'  
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Testing process-event Edge Function${NC}"
echo "=================================="

# Test 1: Basic event processing
echo -e "\n${BLUE}Test 1: Basic Event Processing${NC}"
response=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/process-event" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\": \"${TEST_FACEBOOK_EVENT_ID}\"}")

if echo "$response" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ Basic event processing: PASSED${NC}"
    echo "Event ID: $(echo $response | jq -r '.eventId')"
else
    echo -e "${RED}❌ Basic event processing: FAILED${NC}"
    echo "Response: $response"
fi

# Test 2: Festival with Clashfinder processing
echo -e "\n${BLUE}Test 2: Festival Event with Clashfinder${NC}"
festival_response=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/process-event" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"eventId\": \"${TEST_FACEBOOK_EVENT_ID}\", \"processClashfinder\": true}")

if echo "$festival_response" | grep -q '"success":true'; then
    echo -e "${GREEN}✅ Festival processing: PASSED${NC}"
    
    # Check if festival was detected
    if echo "$festival_response" | grep -q '"isFestival":true'; then
        echo -e "${GREEN}  🎪 Festival detected${NC}"
        confidence=$(echo $festival_response | jq -r '.festivalInfo.confidence')
        echo "  Confidence: $confidence"
    else
        echo -e "${BLUE}  📅 Regular event (not a festival)${NC}"
    fi
    
    # Check if Clashfinder data was found
    if echo "$festival_response" | grep -q '"clashfinderResults"'; then
        clashfinder_success=$(echo $festival_response | jq -r '.clashfinderResults.success')
        if [ "$clashfinder_success" = "true" ]; then
            events_processed=$(echo $festival_response | jq -r '.clashfinderResults.eventsProcessed')
            artists_found=$(echo $festival_response | jq -r '.clashfinderResults.artistsFound')
            echo -e "${GREEN}  🎵 Clashfinder timetable processed${NC}"
            echo "  Events: $events_processed, Artists: $artists_found"
        else
            echo -e "${BLUE}  📋 No Clashfinder data available${NC}"
        fi
    fi
else
    echo -e "${RED}❌ Festival processing: FAILED${NC}"
    echo "Response: $festival_response"
fi

# Test 3: Error handling - invalid event ID
echo -e "\n${BLUE}Test 3: Error Handling${NC}"
error_response=$(curl -s -X POST "${SUPABASE_URL}/functions/v1/process-event" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"eventId": "invalid_event_id"}')

if echo "$error_response" | grep -q '"error"'; then
    echo -e "${GREEN}✅ Error handling: PASSED${NC}"
    error_message=$(echo $error_response | jq -r '.error')
    echo "  Error: $error_message"
else
    echo -e "${RED}❌ Error handling: FAILED${NC}"
    echo "Response: $error_response"
fi

# Test 4: CORS preflight
echo -e "\n${BLUE}Test 4: CORS Support${NC}"
cors_response=$(curl -s -X OPTIONS "${SUPABASE_URL}/functions/v1/process-event" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type")

if [ "$(echo $cors_response | wc -c)" -le 5 ]; then
    echo -e "${GREEN}✅ CORS preflight: PASSED${NC}"
else
    echo -e "${RED}❌ CORS preflight: FAILED${NC}"
    echo "Response: $cors_response"
fi

echo -e "\n${BLUE}🏁 Testing completed!${NC}"
echo "=================================="

# Display summary
echo -e "\n${BLUE}📊 Test Summary${NC}"
echo "• Make sure to update configuration variables at the top of this script"
echo "• Ensure all required environment variables are set in your Supabase project"
echo "• For comprehensive testing, use real Facebook event IDs"
echo "• Check Supabase Functions logs for detailed execution information"

echo -e "\n${GREEN}🎯 Edge Function Features Tested:${NC}"
echo "✓ Basic Facebook event processing"
echo "✓ Festival detection algorithms"  
echo "✓ Clashfinder timetable integration"
echo "✓ Error handling and validation"
echo "✓ CORS support for web applications"

echo -e "\n${BLUE}💡 For monitoring and debugging:${NC}"
echo "supabase functions logs --project-ref YOUR_PROJECT_REF process-event"
