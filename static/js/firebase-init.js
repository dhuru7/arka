// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyBHQB9mnI9_0FgBcgSA2B85xHrTdEYmBZA",
    authDomain: "arka-9686d.firebaseapp.com",
    databaseURL: "https://arka-9686d-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "arka-9686d",
    storageBucket: "arka-9686d.firebasestorage.app",
    messagingSenderId: "1035606198728",
    appId: "1:1035606198728:web:3ca0e3d18ff2f8c84358fd",
    measurementId: "G-95K70E0472"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

// Strict list of allowed authentic email providers
const authenticDomains = [
    'gmail.com',
    'yahoo.com', 'yahoo.in', 'yahoo.co.uk', 'ymail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'mac.com',
    'proton.me', 'protonmail.com',
    'aol.com', 'zoho.com', 'zoho.in', 'mail.com'
];

function isTempEmail(email) {
    const domain = email.split('@')[1];
    if (!domain) return true; // Invalid email

    // Returns TRUE (which blocks the signup) if the domain is NOT in our authentic list
    return !authenticDomains.includes(domain.toLowerCase());
}

async function checkUserLimits(userId, isGuest) {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Check local storage or database if they reached generation limits
    return new Promise((resolve, reject) => {
        db.ref('users/' + userId).once('value', (snapshot) => {
            let data = snapshot.val();
            if (!data) {
                data = { totalGuestDiagrams: 0, dailyUsage: {} };
            }
            if (!data.dailyUsage) data.dailyUsage = {};

            // Check Guest Limits
            if (isGuest && (data.totalGuestDiagrams || 0) >= 5) {
                return reject(new Error("Guest limit reached! Please sign up to generate more diagrams."));
            }

            // Check Daily Limits
            const todayUsage = data.dailyUsage[today] || 0;
            if (todayUsage >= 10) {
                return reject(new Error("Daily limit reached! You can generate a maximum of 10 diagrams per day."));
            }

            resolve(data);
        });
    });
}

async function incrementUserGenerationCount(userId, isGuest) {
    const today = new Date().toISOString().split('T')[0];

    const updates = {};
    updates[`users/${userId}/dailyUsage/${today}`] = firebase.database.ServerValue.increment(1);

    if (isGuest) {
        updates[`users/${userId}/totalGuestDiagrams`] = firebase.database.ServerValue.increment(1);
    }

    return db.ref().update(updates);
}

// ── Download Limit Functions ─────────────────────────────────────────────

async function checkDownloadLimit(userId, isGuest) {
    /**
     * Guest users: 1 PNG download max
     * Signed-up (Google) users: unlimited
     */
    if (!isGuest) {
        return { allowed: true, remaining: Infinity };
    }

    return new Promise((resolve, reject) => {
        db.ref('users/' + userId).once('value', (snapshot) => {
            let data = snapshot.val();
            if (!data) {
                data = { totalDownloads: 0 };
            }
            const downloads = data.totalDownloads || 0;
            const GUEST_DOWNLOAD_LIMIT = 1;

            if (downloads >= GUEST_DOWNLOAD_LIMIT) {
                resolve({ allowed: false, remaining: 0, total: downloads });
            } else {
                resolve({ allowed: true, remaining: GUEST_DOWNLOAD_LIMIT - downloads, total: downloads });
            }
        });
    });
}

async function incrementDownloadCount(userId) {
    const userRef = db.ref('users/' + userId);
    return userRef.transaction((currentData) => {
        if (!currentData) {
            currentData = { totalDownloads: 0 };
        }
        currentData.totalDownloads = (currentData.totalDownloads || 0) + 1;
        return currentData;
    });
}
