import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config(); // Move to the very top
import { GoogleGenAI, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from 'fs';

const logFile = path.join(process.cwd(), 'debug.log');
const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}\n`;
    fs.appendFileSync(logFile, entry);
    console.log(entry);
};

// Log env status once
if (process.env.GEMINI_API_KEY) {
    const key = process.env.GEMINI_API_KEY.trim();
    if (key.includes('MY_GEMINI_API_KEY')) {
        log(`WARNING: GEMINI_API_KEY appears to be a placeholder: ${key}`);
    } else {
        log(`AI Key present (length: ${key.length})`);
    }
} else {
    log('WARNING: GEMINI_API_KEY is not defined in environment');
}

// Helper to get or create AI client
const getAiClient = () => {
    // Check custom name first to bypass AI Studio 'Paid Key' logic, 
    // then fall back to standard name
    const key = (process.env.USER_AI_KEY || process.env.GEMINI_API_KEY)?.trim();
    
    if (!key || key.includes('MY_GEMINI_API_KEY') || key === '') {
        return null;
    }
    return new GoogleGenAI({ apiKey: key });
};

const app = express();
const PORT = 3000;

// In-memory cache for classifications to save quota
const classificationCache = new Map<string, any>();

log('Server starting...');

// Required for secure cookies behind Cloud Run/Nginx proxy
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'intelimail-secret-123',
    resave: true, // Changed from false
    saveUninitialized: true,
    cookie: { 
        secure: true, 
        sameSite: 'none',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 
    }
}));

// Clean APP_URL and redirect URI
const rawAppUrl = (process.env.APP_URL || '').replace(/\/$/, '');
const redirectUri = (process.env.OAUTH_REDIRECT_URI || `${rawAppUrl}/auth/callback`).trim();

log(`Configured Redirect URI: ${redirectUri}`);

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
);

// GMAIL SCOPES
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email'
];

// Simple memory store for the latest login (demo only)
let latestTokens: any = null;

// Auth URL
app.get('/api/auth/url', (req, res) => {
    log('Generating Auth URL');
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        include_granted_scopes: true,
        prompt: 'consent' // Force fresh consent to update scopes
    });
    res.json({ url: authUrl });
});

// OAuth Callback
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    log('Received OAuth callback');
    try {
        const { tokens } = await oauth2Client.getToken(code as string);
        log('Tokens acquired');
        
        // Store in global memory as fallback for the bridge
        latestTokens = tokens;
        (req.session as any).tokens = tokens;
        
        res.send(`
            <html>
                <body>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                            setTimeout(() => window.close(), 500);
                        } else {
                            window.location.href = '/';
                        }
                    </script>
                    <p>Syncing session...</p>
                </body>
            </html>
        `);
    } catch (error) {
        log(`Auth Error: ${error}`);
        res.status(500).send('Authentication failed');
    }
});

// Manual bridge to claim tokens if session cookie failed
app.post('/api/auth/claim', (req, res) => {
    if (latestTokens) {
        log('Claiming tokens via bridge');
        (req.session as any).tokens = latestTokens;
        // Do NOT clear latestTokens yet, let the client verify
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'No recent login found' });
    }
});

app.get('/api/auth/status', (req, res) => {
    const tokens = (req.session as any).tokens || latestTokens; // Use bridge fallback
    if (tokens && !(req.session as any).tokens) {
        (req.session as any).tokens = tokens;
    }
    log(`Status check. Authenticated: ${!!tokens}`);
    res.json({ isAuthenticated: !!tokens });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// Gmail API Proxy
app.get('/api/gmail/messages', async (req, res) => {
    log('Fetching Gmail messages...');
    const tokens = (req.session as any).tokens || latestTokens;
    
    if (!tokens) {
        log('Error: No tokens found');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // Build interaction context by scanning top 100
        log('Scanning 100 metadata headers for interaction context...');
        const scanResponse = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 100
        });
        
        const scanMessages = scanResponse.data.messages || [];
        const contactCounts: Record<string, number> = {};
        
        // Quick parallel metadata scan
        await Promise.all(scanMessages.slice(0, 50).map(async (msg) => {
            try {
                const d = await gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id!,
                    format: 'metadata',
                    metadataHeaders: ['From']
                });
                const fromHeader = d.data.payload?.headers?.find(h => h.name === 'From')?.value || '';
                const email = fromHeader.match(/<(.+?)>/)?.[1] || fromHeader;
                if (email) contactCounts[email] = (contactCounts[email] || 0) + 1;
            } catch (e) {}
        }));

        log('Requesting triage queue');
        const response = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 20
        });
        
        const messages = response.data.messages || [];
        const fullMessages = await Promise.all(messages.map(async (msg) => {
            const detail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'To', 'Date']
            });
            
            // Enrich with interaction data
            const fromHeader = detail.data.payload?.headers?.find(h => h.name === 'From')?.value || '';
            const emailAddr = fromHeader.match(/<(.+?)>/)?.[1] || fromHeader;
            (detail.data as any).interactionContext = {
                count: contactCounts[emailAddr] || 1,
                isFrequent: (contactCounts[emailAddr] || 0) > 2
            };

            return detail.data;
        }));

        log(`Hydrated ${fullMessages.length} messages with deep context`);
        res.json(fullMessages);
    } catch (error: any) {
        log(`Gmail API Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// AI Classification API
app.post('/api/gmail/classify', async (req, res) => {
    const { subject, snippet, from, interactionCount, isFrequentContact } = req.body;
    
    // Check cache first (key by subject + snippet)
    const cacheKey = `${subject}-${snippet}`;
    if (classificationCache.has(cacheKey)) {
        log(`Cache hit for ${subject}`);
        return res.json(classificationCache.get(cacheKey));
    }

    const aiClient = getAiClient();
    if (!aiClient) {
        return res.status(500).json({ error: 'AI Client not initialized. Please ensure GEMINI_API_KEY is correctly set in your Secrets settings and is not the placeholder value.' });
    }

    try {
        const context = isFrequentContact 
            ? `NOTE: This sender is a frequent contact (Interaction count: ${interactionCount}). Prioritize accordingly if the content is legitimate.`
            : `Interaction count for this sender: ${interactionCount}.`;

        const prompt = `${context}\nClassify the following email:\nFrom: ${from}\nSubject: ${subject}\nSnippet: ${snippet}`;

        const result = await aiClient.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [prompt],
            config: {
                systemInstruction: "You are an expert email triage assistant. Analyze emails and prioritize them. Frequent contacts typically implies personal or important business communication. Promotional content should still be categorized as promotional regardless of frequency. Provide an impact score from 0.0 to 10.0 representing the urgency and relevance of the email. Return a JSON object with category, priority, impactScore, summary, actionRequired, and reasoning.",
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        category: { type: Type.STRING, enum: ['important', 'promotional', 'notifications', 'spam', 'personal'] },
                        priority: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
                        impactScore: { type: Type.NUMBER },
                        summary: { type: Type.STRING },
                        actionRequired: { type: Type.BOOLEAN },
                        reasoning: { type: Type.STRING }
                    },
                    required: ['category', 'priority', 'impactScore', 'summary', 'actionRequired', 'reasoning']
                }
            }
        });

        const text = result.text;
        if (!text) throw new Error('Empty AI response');
        
        const classification = JSON.parse(text);
        
        // Save to cache
        classificationCache.set(cacheKey, classification);
        
        res.json(classification);
    } catch (error: any) {
        log(`Classification Error: ${error.message}`);
        
        // Handle Quota/Rate Limit errors specifically
        if (error.message?.includes('429') || error.message?.includes('Quota') || error.status === 429) {
            log('INFO: Gemini API Quota Limit Reached (429) - Frontend will backoff.');
            return res.status(429).json({ error: 'AI Quota exceeded. Slowing down...' });
        }
        
        res.status(500).json({ error: error.message });
    }
});

// Handle Vite middleware
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
