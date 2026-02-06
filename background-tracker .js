const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    cookies: '', // Will be loaded from cookies.txt
    updateInterval: 5 * 60 * 1000, // 5 minutes
    dataFile: path.join(__dirname, 'tracking-data.json'),
    cookieFile: path.join(__dirname, 'cookies.txt')
};

// Load cookies from file
function loadCookies() {
    try {
        if (fs.existsSync(CONFIG.cookieFile)) {
            CONFIG.cookies = fs.readFileSync(CONFIG.cookieFile, 'utf8').trim();
            console.log('✅ Cookies loaded from cookies.txt');
            return true;
        } else {
            console.error('❌ cookies.txt not found! Create it with your session cookies.');
            console.log('\nCreate a file named "cookies.txt" with your cookies:');
            console.log('xf_user=VALUE; xf_session=VALUE; xf_csrf=VALUE');
            return false;
        }
    } catch (err) {
        console.error('❌ Error loading cookies:', err.message);
        return false;
    }
}

// Fetch HTML from URL
function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'Cookie': CONFIG.cookies,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Parse HTML to extract user data
function parseLeaderboard(html) {
    const users = [];
    
    // Simple regex-based parsing since we don't have a DOM parser in Node
    const blockRowRegex = /<div class="block-row[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="block-row|<\/div>)/g;
    const matches = [...html.matchAll(blockRowRegex)];
    
    console.log(`Found ${matches.length} potential user blocks`);
    
    for (let i = 0; i < Math.min(100, matches.length); i++) {
        const block = matches[i][1];
        
        // Extract username
        const usernameMatch = block.match(/class="username[^"]*"[^>]*>([^<]+)</i);
        if (!usernameMatch) continue;
        const username = usernameMatch[1].trim();
        
        // Extract user title
        const titleMatch = block.match(/class="userTitle">([^<]+)</i);
        const userTitle = titleMatch ? titleMatch[1].trim() : '';
        
        // Extract post count
        const postMatch = block.match(/Posts?:\s*([\d,]+)/i);
        if (!postMatch) continue;
        const postCount = parseInt(postMatch[1].replace(/,/g, ''));
        
        // Extract media count
        const mediaMatch = block.match(/Media:\s*([\d,]+)/i);
        const mediaCount = mediaMatch ? parseInt(mediaMatch[1].replace(/,/g, '')) : 0;
        
        // Extract avatar URL
        const avatarMatch = block.match(/src="([^"]*avatar[^"]*)"/i);
        let avatarUrl = avatarMatch ? avatarMatch[1] : '';
        if (avatarUrl && avatarUrl.startsWith('/')) {
            avatarUrl = 'https://incels.is' + avatarUrl;
        } else if (avatarUrl && avatarUrl.startsWith('//')) {
            avatarUrl = 'https:' + avatarUrl;
        }
        
        users.push({
            rank: users.length + 1,
            username,
            userTitle,
            postCount,
            mediaCount,
            avatarUrl,
            timestamp: new Date().toISOString()
        });
    }
    
    return users;
}

// Load existing tracking data
function loadTrackingData() {
    try {
        if (fs.existsSync(CONFIG.dataFile)) {
            const data = JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
            console.log('📊 Loaded existing tracking data');
            return data;
        }
    } catch (err) {
        console.error('⚠️  Error loading tracking data:', err.message);
    }
    
    return {
        lastUpdate: null,
        trackingDate: new Date().toDateString(),
        dailyStartCounts: {},
        currentData: [],
        history: []
    };
}

// Save tracking data
function saveTrackingData(data) {
    try {
        fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2));
        console.log('💾 Tracking data saved');
    } catch (err) {
        console.error('❌ Error saving tracking data:', err.message);
    }
}

// Main update function
async function updateLeaderboard() {
    try {
        console.log('\n🔄 Fetching leaderboard data...');
        const html = await fetchPage('https://incels.is/members/?key=most_posts');
        
        // Check if we got a login page
        if (html.includes('Log in') && html.includes('Password')) {
            console.error('❌ Got login page - cookies expired! Update cookies.txt');
            return;
        }
        
        const users = parseLeaderboard(html);
        
        if (users.length === 0) {
            console.error('❌ No users found - check if website structure changed');
            return;
        }
        
        console.log(`✅ Parsed ${users.length} users`);
        
        // Load existing data
        const trackingData = loadTrackingData();
        
        // Check if it's a new day
        const today = new Date().toDateString();
        if (trackingData.trackingDate !== today) {
            console.log('📅 New day detected - resetting daily counts');
            trackingData.trackingDate = today;
            trackingData.dailyStartCounts = {};
            users.forEach(user => {
                trackingData.dailyStartCounts[user.username] = user.postCount;
            });
        } else if (Object.keys(trackingData.dailyStartCounts).length === 0) {
            // Initialize daily counts if empty
            users.forEach(user => {
                trackingData.dailyStartCounts[user.username] = user.postCount;
            });
        }
        
        // Calculate daily increases
        users.forEach(user => {
            const startCount = trackingData.dailyStartCounts[user.username] || user.postCount;
            user.dailyIncrease = user.postCount - startCount;
        });
        
        // Update tracking data
        trackingData.lastUpdate = new Date().toISOString();
        trackingData.currentData = users;
        
        // Keep history (last 100 updates)
        trackingData.history.push({
            timestamp: new Date().toISOString(),
            topUser: users[0].username,
            topUserPosts: users[0].postCount
        });
        if (trackingData.history.length > 100) {
            trackingData.history = trackingData.history.slice(-100);
        }
        
        // Save data
        saveTrackingData(trackingData);
        
        // Display top 5
        console.log('\n🏆 Top 5 Postmaxxers:');
        users.slice(0, 5).forEach(user => {
            const increase = user.dailyIncrease > 0 ? ` (+${user.dailyIncrease} today)` : '';
            console.log(`  ${user.rank}. ${user.username}: ${user.postCount.toLocaleString()}${increase}`);
        });
        
        console.log(`\n⏰ Next update in 5 minutes...`);
        
    } catch (error) {
        console.error('❌ Error updating leaderboard:', error.message);
    }
}

// Start the service
async function start() {
    console.log('🚀 POSTMAXXERS.MOE - Background Tracking Service');
    console.log('================================================\n');
    
    // Load cookies
    if (!loadCookies()) {
        process.exit(1);
    }
    
    // Initial update
    await updateLeaderboard();
    
    // Schedule updates every 5 minutes
    setInterval(updateLeaderboard, CONFIG.updateInterval);
    
    console.log('\n✅ Background service running...');
    console.log('💡 Press Ctrl+C to stop');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down gracefully...');
    process.exit(0);
});

// Start the service
start();
