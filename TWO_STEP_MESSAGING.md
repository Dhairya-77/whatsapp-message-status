# Two-Step WhatsApp Messaging System

## 📱 How It Works

This system uses a **two-step messaging approach** to send detailed challan information without requiring custom WhatsApp templates:

### Step 1: Send Template (Open Conversation)
- Sends `hello_world` template to recipient
- Opens 24-hour messaging window
- Status changes to: **"Waiting for Reply"** ⏳

### Step 2: Auto-Send Details (When User Replies)
- User receives template and sends any reply
- Backend webhook detects incoming message
- Automatically sends detailed challan information as text
- Status changes to: **"Details Sent"** ✓

## 🔄 Message Flow

```
Frontend                Backend                WhatsApp API
   |                       |                         |
   |-- Send Template ----->|------------------------>|
   |   (hello_world)       |                         |
   |                       |<-- Template Sent -------|
   |                       |                         |
   |                  Store Pending                  |
   |                  Challan Data                   |
   |                       |                         |
   |                  [WAITING FOR USER REPLY]       |
   |                       |                         |
   |                       |<-- User Reply Message --|
   |                       |                         |
   |                  Detect Reply                   |
   |                  Match Phone #                  |
   |                       |                         |
   |-- Auto-Send Details ->|------------------------>|
   |   (text message)      |                         |
   |                       |                         |
   |<-- Status Update -----|                         |
   |   (detailed_sent)     |                         |
```

## 🎯 Status Flow

1. **idle** → Not sent yet
2. **sending** → Sending template
3. **waiting_reply** → Template sent, waiting for user to reply
4. **replied** → User replied (brief status)
5. **detailed_sent** → Challan details auto-sent ✓
6. **delivered** → WhatsApp delivered (if webhook received)
7. **read** → User read message (if webhook received)
8. **error** → Failed ❌

## ⚙️ Configuration

### Backend (.env)
```env
PORT=3000
WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
```

### Frontend (.env)
```env
VITE_WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
VITE_WHATSAPP_ACCESS_TOKEN=your_access_token
VITE_WHATSAPP_TEMPLATE_NAME=hello_world
VITE_WEBSOCKET_URL=ws://localhost:3000
VITE_BACKEND_URL=http://localhost:3000
```

## 🚀 Running the System

### 1. Start Backend (Terminal 1)
```bash
cd backend
npm install
npm run dev
```

### 2. Start Frontend (Terminal 2)
```bash
cd frontend
npm install
npm run dev
```

## 💡 Why This Approach?

### Problem
- WhatsApp requires **templates** for unsolicited messages
- Custom templates need **business verification (GST)**
- Can't send free-form text without 24-hour window

### Solution
1. ✅ Use default `hello_world` template (no verification needed)
2. ✅ User replies → Opens 24-hour window
3. ✅ Auto-send detailed challan as text message
4. ✅ No custom template required!

## ⚡ API Endpoints

### POST /api/pending-challan
Register a pending challan for auto-sending when user replies.

**Request:**
```json
{
  "phoneNumber": "919876543210",
  "challanData": "Dear User, Your challan details...",
  "messageId": "wamid.xxxxx"
}
```

### GET /api/pending-challans
View all pending challans (debugging).

### POST /webhook
WhatsApp webhook for status updates and incoming messages.

## 📊 Excel Export

The Excel export shows:
- **Sent**: ✓ if template sent successfully
- **Delivered**: ✓ if details sent successfully
- **Read**: ✓ if user read the message

## 🐛 Debugging

### Check Pending Challans
Visit: `http://localhost:3000/api/pending-challans`

### Check Message Statuses
Visit: `http://localhost:3000/api/statuses`

### Console Logs
- Frontend: Check browser console
- Backend: Check terminal output

## ⚠️ Important Notes

1. **User must reply** for details to be sent
2. **24-hour window** opens when template is sent
3. **Webhook must be configured** in Meta Business Suite
4. **ngrok or public URL** needed for webhook in production

## 🎓 Future Enhancements

- Add retry mechanism for failed auto-sends
- Store data in database instead of memory
- Add expiration for old pending challans (>24 hours)
- Send reminder if user doesn't reply within X hours
