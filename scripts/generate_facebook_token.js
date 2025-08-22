import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function askHiddenQuestion(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    let input = '';
    
    const onData = (key) => {
      if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        console.log('');
        resolve(input);
      } else if (key === '\u0003') { // Ctrl+C
        process.exit();
      } else if (key === '\u007f') { // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += key;
        process.stdout.write('*');
      }
    };
    
    process.stdin.on('data', onData);
  });
}

async function generateLongLivedToken() {
  console.log('🔑 Facebook Long-Lived Token Generator');
  console.log('=====================================');
  console.log('');
  console.log('Please provide the following information from Facebook Developers Console:');
  console.log('(Visit: https://developers.facebook.com/apps/)');
  console.log('');

  try {
    // Get required information
    const appId = await askQuestion('📱 App ID: ');
    if (!appId) {
      console.log('❌ App ID is required');
      process.exit(1);
    }

    const appSecret = await askHiddenQuestion('🔐 App Secret: ');
    if (!appSecret) {
      console.log('❌ App Secret is required');
      process.exit(1);
    }

    const shortToken = await askHiddenQuestion('🎫 Short-lived User Access Token: ');
    if (!shortToken) {
      console.log('❌ Short-lived token is required');
      process.exit(1);
    }

    console.log('');
    console.log('🚀 Generating long-lived token...');
    console.log('');

    // Make the API call
    const url = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.access_token) {
      console.log('✅ Success! Long-lived token generated:');
      console.log('');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      
      // Update .env file
      const envPath = join(__dirname, '..', '.env');
      try {
        let envContent = readFileSync(envPath, 'utf8');
        
        // Replace the LONG_LIVED_TOKEN line
        const tokenLine = `LONG_LIVED_TOKEN=${data.access_token}`;
        if (envContent.includes('LONG_LIVED_TOKEN=')) {
          envContent = envContent.replace(/LONG_LIVED_TOKEN=.*/, tokenLine);
        } else {
          envContent += `\n${tokenLine}`;
        }
        
        writeFileSync(envPath, envContent);
        console.log('✅ .env file updated with new token!');
        
        // Update Supabase secrets
        console.log('');
        console.log('🔄 Now updating Supabase secrets...');
        
        const updateSupabaseScript = `
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function updateSupabaseSecret() {
  try {
    // Delete old secret
    await supabase.from('vault.secrets').delete().eq('name', 'FACEBOOK_LONG_LIVED_TOKEN');
    
    // Insert new secret
    const { error } = await supabase.from('vault.secrets').insert({
      name: 'FACEBOOK_LONG_LIVED_TOKEN',
      secret: '${data.access_token}'
    });
    
    if (error) {
      console.error('❌ Error updating Supabase secret:', error);
    } else {
      console.log('✅ Supabase secret updated successfully!');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

updateSupabaseSecret();
        `;
        
        writeFileSync(join(__dirname, '..', 'temp_update_supabase.js'), updateSupabaseScript);
        
        // Execute the script
        const { exec } = await import('child_process');
        exec('node temp_update_supabase.js', { cwd: join(__dirname, '..') }, (error, stdout, stderr) => {
          if (error) {
            console.error('❌ Error updating Supabase:', error.message);
          } else {
            console.log(stdout);
          }
          
          // Cleanup temp file
          try {
            const { unlinkSync } = await import('fs');
            unlinkSync(join(__dirname, '..', 'temp_update_supabase.js'));
          } catch (e) {
            // Ignore cleanup errors
          }
          
          console.log('');
          console.log('🎉 Token generation complete!');
          console.log('⏱️ This token is valid for approximately 60 days.');
          console.log('');
          console.log('🔗 Useful links:');
          console.log('• Access Token Debugger: https://developers.facebook.com/tools/debug/accesstoken/');
          
          rl.close();
        });
        
      } catch (err) {
        console.error('❌ Error updating .env file:', err.message);
        console.log('');
        console.log('📝 Please manually update your .env file:');
        console.log(`LONG_LIVED_TOKEN=${data.access_token}`);
        rl.close();
      }
      
    } else {
      console.log('❌ Error occurred:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      console.log('Common issues:');
      console.log('• Make sure your short-lived token is valid and not expired');
      console.log('• Verify your App ID and App Secret are correct');
      console.log('• Check that your Facebook app has the necessary permissions');
      rl.close();
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    rl.close();
  }
}

generateLongLivedToken();
