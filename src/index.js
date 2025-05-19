import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import stkRoutes from "./routes/stkRoutes.js";
import cors from "cors";

dotenv.config({ path: "./src/.env" });

const corsOptions = {
  origin: true, // Allow all origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true // Allow cookies / credentials
};

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors(corsOptions));

// Middleware
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use("/api", stkRoutes);

// Health check
app.get("/", (req, res) => {
  res.status(200).json({ 
    message: "Server is up and running!",
    note: "CORS is configured to allow all origins."
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("CORS: All origins are allowed.");
});

export { app, PORT };
