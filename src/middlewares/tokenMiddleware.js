// src/middlewares/tokenMiddleware.js
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// Helper function for caching token
let cachedToken = null;

// Middleware to get or refresh the token
const getToken = async (req, res, next) => {
    try {
        if (cachedToken && Date.now() < cachedToken.expiryTime) {
            req.token = cachedToken.access_token;
            return next();
        }

        const consumerKey = process.env.M_PESA_CONSUMER_KEY;
        const consumerSecret = process.env.M_PESA_CONSUMER_SECRET;
        const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

        const response = await axios.get(
            'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${auth}`,
                },
            }
        );

        const { access_token, expires_in } = response.data;
        const expiryTime = Date.now() + expires_in * 1000;

        cachedToken = { access_token, expiryTime };
        req.token = access_token;
        next();
    } catch (error) {
        console.error('Error generating token:', error.message);
        res.status(500).json({
            error: 'Failed to authenticate with Safaricom API.',
            message: error.message,
        });
    }
};

export { getToken };
