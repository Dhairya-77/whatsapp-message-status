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

// Store pending challan data for two-step messaging
// Key: phone number (without +), Value: { challanData, messageId, timestamp }
const pendingChallans = new Map();

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

                        // Handle incoming messages - AUTO-SEND CHALLAN DETAILS
                        if (value.messages) {
                            value.messages.forEach(async (message) => {
                                console.log('Received incoming message:', message);

                                // Get sender's phone number
                                const senderPhone = message.from;
                                console.log(`Message from: ${senderPhone}`);

                                // Check if we have a pending challan for this number
                                if (pendingChallans.has(senderPhone)) {
                                    const pendingData = pendingChallans.get(senderPhone);
                                    console.log(`Found pending challan for ${senderPhone}, auto-sending details...`);

                                    // Send notification to frontend that user replied
                                    broadcastStatusUpdate(pendingData.messageId, 'replied');

                                    // Auto-send the detailed challan message
                                    try {
                                        const axios = await import('axios');
                                        const response = await axios.default.post(
                                            `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
                                            {
                                                messaging_product: 'whatsapp',
                                                to: senderPhone,
                                                type: 'text',
                                                text: { body: pendingData.challanData }
                                            },
                                            {
                                                headers: {
                                                    'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                                                    'Content-Type': 'application/json'
                                                }
                                            }
                                        );

                                        console.log(`Challan details sent to ${senderPhone}:`, response.data);

                                        // Update status to 'detailed_sent'
                                        const detailedMessageId = response.data.messages?.[0]?.id;
                                        if (detailedMessageId) {
                                            messageStatuses.set(detailedMessageId, 'detailed_sent');
                                            broadcastStatusUpdate(pendingData.messageId, 'detailed_sent');
                                        }

                                        // Remove from pending queue
                                        pendingChallans.delete(senderPhone);
                                        console.log(`Removed ${senderPhone} from pending queue`);

                                    } catch (error) {
                                        console.error(`Error sending detailed message to ${senderPhone}:`, error);
                                        broadcastStatusUpdate(pendingData.messageId, 'error');
                                    }
                                } else {
                                    console.log(`No pending challan for ${senderPhone}`);
                                }
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

// API endpoint to register a pending challan (for two-step messaging)
app.post('/api/pending-challan', (req, res) => {
    try {
        const { phoneNumber, challanData, messageId } = req.body;

        if (!phoneNumber || !challanData || !messageId) {
            return res.status(400).json({
                error: 'Missing required fields: phoneNumber, challanData, messageId'
            });
        }

        // Store pending challan
        pendingChallans.set(phoneNumber, {
            challanData,
            messageId,
            timestamp: Date.now()
        });

        console.log(`Registered pending challan for ${phoneNumber}`);
        res.json({
            success: true,
            message: 'Pending challan registered',
            phoneNumber
        });
    } catch (error) {
        console.error('Error registering pending challan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// API endpoint to get pending challans (for debugging)
app.get('/api/pending-challans', (req, res) => {
    const pending = Object.fromEntries(pendingChallans);
    res.json({ count: pendingChallans.size, pending });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
    console.log(`WebSocket URL: ws://localhost:${PORT}`);
});
