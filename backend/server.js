import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'your_verify_token_here';

// Middleware
app.use(express.json());

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store message statuses in memory (in production, use a database)
const messageStatuses = new Map();

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');

    // Send all current statuses to newly connected client
    const allStatuses = Object.fromEntries(messageStatuses);
    ws.send(JSON.stringify({ type: 'initial', statuses: allStatuses }));

    ws.on('close', () => {
        console.log('Client disconnected from WebSocket');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Broadcast status update to all connected clients
function broadcastStatusUpdate(messageId, status) {
    const message = JSON.stringify({
        type: 'status_update',
        messageId,
        status
    });

    wss.clients.forEach((client) => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'WhatsApp Webhook Server is running',
        connectedClients: wss.clients.size
    });
});

// Webhook verification (GET) - Meta will call this to verify your webhook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('Webhook verification request:', { mode, token, challenge });

    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
        console.log('Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        console.log('Webhook verification failed');
        res.status(403).send('Forbidden');
    }
});

// Webhook receiver (POST) - Meta will call this with status updates
app.post('/webhook', (req, res) => {
    const body = req.body;

    console.log('Webhook received:', JSON.stringify(body, null, 2));

    try {
        // Check if this is a WhatsApp webhook event
        if (body.object === 'whatsapp_business_account') {
            body.entry?.forEach((entry) => {
                entry.changes?.forEach((change) => {
                    if (change.field === 'messages') {
                        const value = change.value;

                        // Handle message status updates
                        if (value.statuses) {
                            value.statuses.forEach((status) => {
                                const messageId = status.id;
                                const statusType = status.status; // delivered, read, sent, failed

                                console.log(`Message ${messageId} status: ${statusType}`);

                                // Store the status
                                messageStatuses.set(messageId, statusType);

                                // Broadcast to all connected WebSocket clients
                                broadcastStatusUpdate(messageId, statusType);
                            });
                        }

                        // Handle incoming messages (optional - for future use)
                        if (value.messages) {
                            value.messages.forEach((message) => {
                                console.log('Received message:', message);
                            });
                        }
                    }
                });
            });

            res.status(200).send('EVENT_RECEIVED');
        } else {
            res.status(404).send('Not Found');
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API endpoint to get status of a specific message
app.get('/api/status/:messageId', (req, res) => {
    const status = messageStatuses.get(req.params.messageId);
    res.json({ messageId: req.params.messageId, status: status || 'unknown' });
});

// API endpoint to get all statuses
app.get('/api/statuses', (req, res) => {
    const allStatuses = Object.fromEntries(messageStatuses);
    res.json(allStatuses);
});

// Start server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
    console.log(`WebSocket URL: ws://localhost:${PORT}`);
});
