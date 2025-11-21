import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import axios from 'axios'
import './App.css'

interface ChallanData {
  [key: string]: unknown
  'Violator Contact'?: string | number
}

interface ExtractedChallan {
  mobile: string
  data: ChallanData
}

type MessageStatus = 'idle' | 'sending' | 'sent' | 'waiting_reply' | 'replied' | 'detailed_sent' | 'delivered' | 'read' | 'error'

function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [extractedChallans, setExtractedChallans] = useState<ExtractedChallan[]>([])
  const [messageStatuses, setMessageStatuses] = useState<Record<number, MessageStatus>>({})
  const [messageIds, setMessageIds] = useState<Record<number, string>>({})
  const [showDetails, setShowDetails] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  // WhatsApp API Configuration from environment variables
  const PHONE_NUMBER_ID = import.meta.env.VITE_WHATSAPP_PHONE_NUMBER_ID || ''
  const ACCESS_TOKEN = import.meta.env.VITE_WHATSAPP_ACCESS_TOKEN || ''
  const TEMPLATE_NAME = import.meta.env.VITE_WHATSAPP_TEMPLATE_NAME || 'hello_world'
  const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:3000'
  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000'

  // WebSocket connection for real-time status updates
  useEffect(() => {
    console.log('Connecting to WebSocket:', WEBSOCKET_URL)
    const ws = new WebSocket(WEBSOCKET_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        console.log('WebSocket message received:', data)

        if (data.type === 'status_update') {
          const { messageId, status } = data

          // Find the index of the message with this ID
          const index = Object.entries(messageIds).find(
            ([_, id]) => id === messageId
          )?.[0]

          if (index !== undefined) {
            const indexNum = parseInt(index)
            console.log(`Updating status for index ${indexNum} to ${status}`)
            setMessageStatuses(prev => ({
              ...prev,
              [indexNum]: status as MessageStatus
            }))
          }
        } else if (data.type === 'initial') {
          console.log('Received initial statuses:', data.statuses)
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
    }

    return () => {
      ws.close()
    }
  }, [WEBSOCKET_URL, messageIds])

  const getStatusLabel = (status: MessageStatus) => {
    switch (status) {
      case 'sending':
        return 'Sending'
      case 'sent':
        return 'Template Sent'
      case 'waiting_reply':
        return 'Waiting for Reply'
      case 'replied':
        return 'User Replied'
      case 'detailed_sent':
        return 'Details Sent'
      case 'delivered':
        return 'Delivered'
      case 'read':
        return 'Read'
      case 'error':
        return 'Failed'
      default:
        return 'Not Sent'
    }
  }

  const handleDownloadStatusReport = () => {
    if (extractedChallans.length === 0) {
      alert('No challans available to export')
      return
    }

    // Prepare data for Excel export
    const excelData = extractedChallans.map((challan, index) => {
      const status: MessageStatus = messageStatuses[index] || 'idle'
      const name = String(challan.data['Name'] || challan.data['Violator Name'] || challan.data['Name of Violator'] || 'N/A')
      const amount = String(challan.data['Amount'] || challan.data['Challan Amount'] || challan.data['Fine Amount'] || challan.data['Total Amount'] || 'N/A')
      const challanNo = String(challan.data['Challan No'] || challan.data['Challan Number'] || challan.data['Challan ID'] || 'N/A')
      const vehicle = String(challan.data['Vehicle Number'] || challan.data['Vehicle No'] || challan.data['Registration No'] || 'N/A')

      // Use tick (✓) for success and cross (✗) for failure/not done
      const sentStatus = (status === 'sent' || status === 'waiting_reply' || status === 'replied' || status === 'detailed_sent' || status === 'delivered' || status === 'read') ? '✓' : '✗'
      const deliveredStatus = (status === 'detailed_sent' || status === 'delivered' || status === 'read') ? '✓' : '✗'
      const readStatus = status === 'read' ? '✓' : '✗'

      return {
        '#': index + 1,
        'Name': name,
        'Mobile': challan.mobile,
        'Challan No': challanNo,
        'Vehicle No': vehicle,
        'Amount': amount,
        'Sent': sentStatus,
        'Delivered': deliveredStatus,
        'Read': readStatus
      }
    })

    // Create a new workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Challan Status Report')

    // Auto-size columns
    const maxWidth = 20
    const colWidths = [
      { wch: 5 },   // #
      { wch: 20 },  // Name
      { wch: 15 },  // Mobile
      { wch: 15 },  // Challan No
      { wch: 15 },  // Vehicle No
      { wch: 10 },  // Amount
      { wch: 8 },   // Sent
      { wch: 10 },  // Delivered
      { wch: 8 }    // Read
    ]
    worksheet['!cols'] = colWidths

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `challan-status-report-${timestamp}.xlsx`

    // Save the file
    XLSX.writeFile(workbook, filename)
  }

  const extractMobileNumbers = (data: Record<string, ChallanData[]>): ExtractedChallan[] => {
    const challans: ExtractedChallan[] = []

    Object.values(data).forEach((sheetData) => {
      sheetData.forEach((row) => {
        const contact = row['Violator Contact']

        if (contact) {
          // Convert to string and clean the mobile number
          let mobile = String(contact).trim()

          // Remove any non-digit characters except + at the start
          if (mobile.startsWith('+')) {
            mobile = '+' + mobile.slice(1).replace(/\D/g, '')
          } else {
            mobile = mobile.replace(/\D/g, '')
          }

          // Basic validation - should have at least 10 digits
          if (mobile.length >= 10) {
            // If no country code, assume it's Indian number format
            if (!mobile.startsWith('+') && mobile.length === 10) {
              mobile = '91' + mobile // Add India country code
            } else if (!mobile.startsWith('+') && mobile.length > 10) {
              mobile = '+' + mobile
            } else if (!mobile.startsWith('+')) {
              mobile = '+91' + mobile
            }

            challans.push({
              mobile,
              data: row
            })
          }
        }
      })
    })

    return challans
  }

  const formatChallanMessage = (challanData: ChallanData): string => {
    // Extract relevant challan information
    const name = challanData['Name'] || challanData['Violator Name'] || challanData['Name of Violator'] || 'N/A'
    const amount = challanData['Amount'] || challanData['Challan Amount'] || challanData['Fine Amount'] || challanData['Total Amount'] || 'N/A'
    const challanNo = challanData['Challan No'] || challanData['Challan Number'] || challanData['Challan ID'] || 'N/A'
    const date = challanData['Date'] || challanData['Challan Date'] || challanData['Issue Date'] || 'N/A'
    const violation = challanData['Violation'] || challanData['Violation Type'] || challanData['Offense'] || 'N/A'
    const vehicle = challanData['Vehicle Number'] || challanData['Vehicle No'] || challanData['Registration No'] || 'N/A'
    const location = challanData['Location'] || challanData['Place'] || challanData['Violation Location'] || 'N/A'

    return `
🏛️ *Traffic Challan Notification*

Dear ${name},

You have received a traffic challan with the following details:

📋 *Challan Details:*
• Challan Number: ${challanNo}
• Date: ${date}
• Vehicle Number: ${vehicle}
• Violation: ${violation}
• Location: ${location}

💰 *Challan Amount: ₹${amount}*

Please pay the challan amount at your earliest convenience to avoid additional penalties.

For any queries, please contact the traffic department.

Thank you.
    `.trim()
  }

  const sendWhatsAppMessage = async (mobile: string, challanData: ChallanData, index: number) => {
    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
      alert('Please configure WhatsApp API credentials in .env file')
      return
    }

    setMessageStatuses(prev => ({ ...prev, [index]: 'sending' }))

    try {
      // STEP 1: Send hello_world template to open conversation
      const response = await axios.post(
        `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
        {
          "messaging_product": "whatsapp",
          "to": mobile,
          "type": "template",
          "template": {
            "name": TEMPLATE_NAME,
            "language": {
              "code": "en_US"
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      )

      console.log(`WhatsApp template sent to ${mobile}:`, response.data)

      // Store the message ID for tracking
      const messageId = response.data.messages?.[0]?.id
      if (messageId) {
        setMessageIds(prev => ({ ...prev, [index]: messageId }))
        console.log(`Stored message ID ${messageId} for index ${index}`)
      }

      // STEP 2: Register pending challan on backend (will auto-send when user replies)
      const challanText = formatChallanMessage(challanData)
      try {
        await axios.post(`${BACKEND_URL}/api/pending-challan`, {
          phoneNumber: mobile,
          challanData: challanText,
          messageId: messageId
        })
        console.log(`Registered pending challan for ${mobile}`)
      } catch (regError) {
        console.error('Error registering pending challan:', regError)
      }

      // Update status to "waiting for reply"
      setMessageStatuses(prev => ({ ...prev, [index]: 'waiting_reply' }))

    } catch (error: unknown) {
      console.error(`Error sending WhatsApp template to ${mobile}:`, error)
      setMessageStatuses(prev => ({ ...prev, [index]: 'error' }))

      if (axios.isAxiosError(error) && error.response?.data) {
        const errorData = error.response.data
        console.error('WhatsApp API Error:', errorData)
        alert(`Failed to send message to ${mobile}.\n\nError: ${errorData.error?.message || 'Unknown error'}\n\nCheck console for details.`)
      } else {
        alert(`Failed to send message to ${mobile}. Check console for details.`)
      }
    }
  }

  const sendAllMessages = async () => {
    if (extractedChallans.length === 0) {
      alert('No challans to send')
      return
    }

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
      alert('Please configure WhatsApp API credentials in .env file')
      return
    }

    if (!confirm(`Send WhatsApp messages to ${extractedChallans.length} numbers?`)) {
      return
    }

    // Send messages one by one with a small delay to avoid rate limiting
    for (let i = 0; i < extractedChallans.length; i++) {
      const challan = extractedChallans[i]
      await sendWhatsAppMessage(challan.mobile, challan.data, i)

      // Add delay between messages (1 second)
      if (i < extractedChallans.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    // Check if file is Excel format
    const validExtensions = ['.xlsx', '.xls', '.xlsm', '.csv']
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()

    if (!validExtensions.includes(fileExtension)) {
      alert('Please upload a valid Excel file (.xlsx, .xls, .xlsm, or .csv)')
      event.target.value = ''
      return
    }

    setFileName(file.name)
    setIsProcessing(true)
    setExtractedChallans([])
    setMessageStatuses({})
    setMessageIds({})

    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })

      // Convert all sheets to JSON
      const convertedData: Record<string, ChallanData[]> = {}

      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const jsonSheet = XLSX.utils.sheet_to_json<ChallanData>(worksheet)
        convertedData[sheetName] = jsonSheet
      })

      // Extract mobile numbers from "Violator Contact" key
      const extracted = extractMobileNumbers(convertedData)
      setExtractedChallans(extracted)

      // Print to console
      console.log('Excel File Data (JSON):', convertedData)
      console.log('File Name:', file.name)
      console.log('Extracted Challans:', extracted)

      // If single sheet, also log it separately for easier access
      if (workbook.SheetNames.length === 1) {
        console.log('Converted Data:', convertedData[workbook.SheetNames[0]])
      }

      if (extracted.length > 0) {
        setShowDetails(true)
        alert(`Excel file converted successfully!\nFound ${extracted.length} challan(s) with mobile numbers.\nCheck the console for JSON data.`)
      } else {
        alert('Excel file converted successfully, but no mobile numbers found in "Violator Contact" column.')
      }
    } catch (error) {
      console.error('Error processing Excel file:', error)
      alert('Error processing Excel file. Please try again.')
      setFileName(null)
    } finally {
      setIsProcessing(false)
      // Reset input to allow re-uploading the same file
      event.target.value = ''
    }
  }

  const handleReset = (event?: React.MouseEvent) => {
    if (event) {
      event.stopPropagation()
      event.preventDefault()
    }
    setFileName(null)
    setIsProcessing(false)
    setExtractedChallans([])
    setMessageStatuses({})
    setMessageIds({})
    setShowDetails(false)
    // Reset file input
    const fileInput = document.getElementById('excel-file-input') as HTMLInputElement
    if (fileInput) {
      fileInput.value = ''
    }
  }

  return (
    <div className="app-container">
      <div className="landing-page">
        <div className="content-card">
          <h1>Challan Notification System</h1>
          <p className="subtitle">Upload Excel file to send WhatsApp notifications</p>

          <div className="upload-area">
            <input
              type="file"
              id="excel-file-input"
              accept=".xlsx,.xls,.xlsm,.csv"
              onChange={handleFileUpload}
              className="file-input"
              disabled={isProcessing}
            />
            <label htmlFor="excel-file-input" className={`file-label ${isProcessing ? 'disabled' : ''}`}>
              {isProcessing ? (
                <span>Processing...</span>
              ) : fileName ? (
                <>
                  <span className="file-icon">✓</span>
                  <span className="file-name">{fileName}</span>
                  <button
                    type="button"
                    className="reset-btn"
                    onClick={handleReset}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <span className="file-icon">📁</span>
                  <span>Choose Excel File</span>
                  <span className="file-hint">or drag and drop</span>
                </>
              )}
            </label>
          </div>

          {showDetails && extractedChallans.length > 0 && (
            <div className="challan-results">
              <div className="results-header">
                <h3>Found {extractedChallans.length} Challan(s)</h3>
                <div className="results-actions">
                  <button
                    className="send-all-btn"
                    onClick={sendAllMessages}
                    disabled={Object.values(messageStatuses).some(status => status === 'sending')}
                  >
                    {Object.values(messageStatuses).some(status => status === 'sending')
                      ? 'Sending...'
                      : 'Send All Messages'}
                  </button>
                  <button
                    className="download-report-btn"
                    type="button"
                    onClick={handleDownloadStatusReport}
                    disabled={extractedChallans.length === 0}
                  >
                    Download Status Report
                  </button>
                </div>
              </div>

              <div className="challan-list">
                {extractedChallans.map((challan, index) => {
                  const status = messageStatuses[index] || 'idle'
                  const name = String(challan.data['Name'] || challan.data['Violator Name'] || challan.data['Name of Violator'] || 'N/A')
                  const amount = String(challan.data['Amount'] || challan.data['Challan Amount'] || challan.data['Fine Amount'] || challan.data['Total Amount'] || 'N/A')

                  return (
                    <div key={index} className="challan-item">
                      <div className="challan-info">
                        <div className="challan-header">
                          <span className="challan-name">{name}</span>
                          <span className="challan-mobile">{challan.mobile}</span>
                        </div>
                        <div className="challan-amount">Amount: ₹{amount}</div>
                        <div className={`status-chip status-${status}`}>
                          {getStatusLabel(status)}
                        </div>
                      </div>
                      <button
                        className={`send-btn status-${status}`}
                        onClick={() => sendWhatsAppMessage(challan.mobile, challan.data, index)}
                        disabled={status === 'sending' || status === 'waiting_reply' || status === 'replied' || status === 'detailed_sent' || status === 'delivered' || status === 'read'}
                      >
                        {status === 'idle' && 'Send'}
                        {status === 'sending' && 'Sending...'}
                        {status === 'sent' && 'Template Sent'}
                        {status === 'waiting_reply' && 'Waiting...'}
                        {status === 'replied' && 'User Replied'}
                        {status === 'detailed_sent' && 'Details Sent ✓'}
                        {status === 'delivered' && 'Delivered'}
                        {status === 'read' && 'Read'}
                        {status === 'error' && 'Retry'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {showDetails && extractedChallans.length === 0 && (
            <div className="no-results">
              <p>No mobile numbers found in "Violator Contact" column.</p>
              <p className="note">Make sure your Excel file has a column named "Violator Contact" with mobile numbers.</p>
            </div>
          )}

          <div className="info-section">
            <h3>Supported Formats</h3>
            <div className="formats">
              <span className="format-badge">.xlsx</span>
              <span className="format-badge">.xls</span>
              <span className="format-badge">.xlsm</span>
              <span className="format-badge">.csv</span>
            </div>
            <p className="note">
              The Excel file should contain a "Violator Contact" column with mobile numbers.
              <br />
              Configure WhatsApp API credentials in <code>.env</code> file.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
