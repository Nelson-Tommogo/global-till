import express from "express";
import axios from "axios";
import moment from "moment";
import { getToken } from "../middlewares/tokenMiddleware.js";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// Helper function to generate password
const generatePassword = (shortCode, passKey) => {
  const timestamp = moment().format("YYYYMMDDHHmmss");
  return {
    password: Buffer.from(`${shortCode}${passKey}${timestamp}`).toString("base64"),
    timestamp,
  };
};

// Helper function to validate and format phone number
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;

  // Remove any non-digit characters
  const cleaned = phoneNumber.toString().replace(/\D/g, '');

  // Handle Kenyan numbers
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `254${cleaned.substring(1)}`;
  }
  if (cleaned.startsWith('254') && cleaned.length === 12) {
    return cleaned;
  }
  if (cleaned.length === 9) {
    return `254${cleaned}`;
  }

  return null;
};

// Route to test token generation
router.get("/test-token", getToken, (req, res) => {
  res.status(200).json({
    message: "Token generated successfully",
    token: req.token,
  });
});

// Route to handle STK push request
router.post("/stk", getToken, async (req, res) => {
  try {
    const token = req.token;
    let { phoneNumber, amount } = req.body;

    if (!phoneNumber || !amount) {
      return res.status(400).json({ 
        error: "Phone number and amount are required fields." 
      });
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);
    if (!formattedPhone) {
      return res.status(400).json({ 
        error: "Invalid phone number format. Expected formats: 07XXXXXXXX, 2547XXXXXXXX, or XXXXXXXXX (9 digits)" 
      });
    }

    const { password, timestamp } = generatePassword(
      process.env.M_PESA_SHORT_CODE,
      process.env.M_PESA_PASSKEY
    );

    // Use Till Number if available, else fallback to Short Code
    const partyB = process.env.M_PESA_TILL_NUMBER || process.env.M_PESA_SHORT_CODE;

    const requestBody = {
      BusinessShortCode: process.env.M_PESA_SHORT_CODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: process.env.M_PESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
      Amount: amount,
      PartyA: formattedPhone,
      PartyB: partyB,
      PhoneNumber: formattedPhone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: process.env.M_PESA_ACCOUNT_REFERENCE || "PaymentRef",
      TransactionDesc: process.env.M_PESA_TRANSACTION_DESC || "Payment for goods/services",
    };

    const response = await axios.post(
      `${process.env.BASE_URL}mpesa/stkpush/v1/processrequest`,
      requestBody,
      { 
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }, 
      }
    );

    if (response.data.ResponseCode === "0") {
      return res.status(200).json({
        message: "STK push request sent successfully.",
        checkoutRequestID: response.data.CheckoutRequestID,
        merchantRequestID: response.data.MerchantRequestID,
        responseDescription: response.data.ResponseDescription,
      });
    } else {
      return res.status(400).json({
        error: "Failed to initiate STK push.",
        responseDescription: response.data.ResponseDescription,
      });
    }
  } catch (error) {
    console.error("Error during STK Push:", error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: "Safaricom API Error",
        message: error.response.data.errorMessage || error.response.data,
      });
    }
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
});

// Route to handle callback with basic validation
router.post("/callback", async (req, res) => {
  try {
    if (!req.body || !req.body.Body) {
      return res.status(400).json({ error: "Invalid callback data" });
    }

    const callbackData = req.body;
    const resultCode = callbackData.Body.stkCallback.ResultCode;
    
    if (resultCode !== 0) {
      return res.status(400).json({
        ResultCode: resultCode,
        ResultDesc: callbackData.Body.stkCallback.ResultDesc,
      });
    }

    const metadata = callbackData.Body.stkCallback.CallbackMetadata;
    if (!metadata || !metadata.Item) {
      return res.status(400).json({ error: "Invalid callback metadata" });
    }

    const getItemValue = (name) => {
      const item = metadata.Item.find(obj => obj.Name === name);
      return item ? item.Value : null;
    };

    return res.status(200).json({
      message: "Callback processed successfully.",
      transaction: {
        amount: getItemValue("Amount"),
        mpesaCode: getItemValue("MpesaReceiptNumber"),
        phone: getItemValue("PhoneNumber"),
        date: getItemValue("TransactionDate"),
      },
    });
  } catch (error) {
    console.error("Callback processing error:", error);
    return res.status(500).json({
      error: "An error occurred while processing the callback.",
      details: error.message,
    });
  }
});

// Route to query STK push status
router.post("/stkquery", getToken, async (req, res) => {
  try {
    const { checkoutRequestID } = req.body;
    if (!checkoutRequestID) {
      return res.status(400).json({ 
        error: "CheckoutRequestID is required" 
      });
    }

    const { password, timestamp } = generatePassword(
      process.env.M_PESA_SHORT_CODE,
      process.env.M_PESA_PASSKEY
    );

    const requestBody = {
      BusinessShortCode: process.env.M_PESA_SHORT_CODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID,
    };

    const response = await axios.post(
      `${process.env.BASE_URL}mpesa/stkpushquery/v1/query`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${req.token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const { ResultCode, ResultDesc } = response.data;
    if (ResultCode === "0") {
      return res.status(200).json({
        status: "Success",
        message: "Payment successful",
        data: response.data,
      });
    } else {
      return res.status(400).json({
        status: "Failure",
        message: ResultDesc,
        data: response.data,
      });
    }
  } catch (error) {
    console.error("STK Query Error:", error.message);
    if (error.response) {
      return res.status(error.response.status).json({
        error: "Safaricom API Error",
        message: error.response.data.errorMessage || error.response.data,
      });
    }
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message,
    });
  }
});

//card Payment Section
router.post("/stripe/create-payment-intent", getToken, async (req, res) => {
  try {
    const { amount, description, metadata } = req.body;
    
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    // Convert amount to cents (or smallest currency unit)
    const amountInCents = Math.round(parseFloat(amount) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: process.env.STRIPE_CURRENCY || "usd",
      description: description || "Payment for goods/services",
      metadata: metadata || {},
      automatic_payment_methods: {
        enabled: true,
      },
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (error) {
    console.error("Stripe Payment Intent Error:", error);
    res.status(500).json({
      error: "Failed to create payment intent",
      message: error.message,
    });
  }
});


router.post("/stripe/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle specific event types
  switch (event.type) {
    case 'payment_intent.succeeded':
      // eslint-disable-next-line no-case-declarations
      const paymentIntent = event.data.object;
      console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);
      // Update your database here
      break;
    case 'payment_intent.payment_failed':
      // eslint-disable-next-line no-case-declarations
      const failedIntent = event.data.object;
      console.error(`Payment failed: ${failedIntent.last_payment_error?.message}`);
      break;
    // Add more event types as needed
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
});

router.post("/stripe/retrieve-payment", getToken, async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: "paymentIntentId is required" });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    res.status(200).json({
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100, // Convert back to dollars
      currency: paymentIntent.currency,
      charges: paymentIntent.charges.data,
    });
  } catch (error) {
    console.error("Stripe Retrieve Payment Error:", error);
    res.status(500).json({
      error: "Failed to retrieve payment",
      message: error.message,
    });
  }
});



export default router;
