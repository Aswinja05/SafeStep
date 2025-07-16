const express = require("express");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const path = require("path");
const mongoose = require("mongoose");
const http = require("http");
const socketIo = require("socket.io");
const { GoogleGenerativeAI } = require("@google/generative-ai");

fetch("https://www.google.com")
  .then((response) => {
    console.log("Google Response:", response.status);
  })
  .catch((error) => {
    console.error("Fetch Error:", error);
  });

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000", // Ensure the frontend is correctly set
    methods: ["GET", "POST"],
  },
});
const users = {};
io.on("connection", (socket) => {
  console.log("New WebSocket connection", socket.id);
  socket.on("track-user", (uid) => {
    console.log(`User ${uid} connected with socket ID: ${socket.id}`);
    users[uid] = socket.id;
    socket.join(uid);
  });
  socket.on("disconnect", () => {
    console.log("WebSocket disconnected");

    // Iterate through users and remove the socket from the relevant user
    for (const uid in users) {
      // If users[uid] is a Set and it contains the socket ID
      if (users[uid] instanceof Set && users[uid].has(socket.id)) {
        users[uid].delete(socket.id); // Remove the socket from the Set for the user
        console.log(`Socket ${socket.id} removed from UID ${uid}`);

        // If there are no sockets left for the user, delete the user entry
        if (users[uid].size === 0) {
          delete users[uid];
          console.log(`All sockets removed for UID ${uid}, user entry deleted`);
        }
      }
    }
  });

  socket.on("stop-tracking", (uid) => {
    if (users[uid]) {
      console.log(`Stopping tracking for UID: ${uid}`);
      io.sockets.sockets.get(users[uid])?.disconnect();
      users[uid].delete();
    }
  });
});

const serviceAccount = require("./serviceKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const MONGODB_URI =
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connection established successfully!");
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  });
  const coordinatesSchema = new mongoose.Schema({
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  });
const userSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true }, // Firebase UID
  email: { type: String }, // User's email
  displayName: { type: String }, // User's name
  type: { type: String, default: "adult" }, 
  fcmToken: { type: String }, // User's own FCM token
  guardians: { 
    type: [String], 
    default: [], 
    set: function(v) { 
      return Array.from(new Set(v)); // Remove duplicates
    } 
  }, // Guardians' FCM tokens
  geofence: { type: [coordinatesSchema], default: []} // Geofence locations
});
const User = mongoose.model("User", userSchema);

const locationSchema = new mongoose.Schema({
  uid: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  notified: { type: Boolean, default: false }, // Track notification status
});
const Locations = mongoose.model("Locations", locationSchema);

app.post("/save-user", async (req, res) => {
  const { uid, email, displayName, fcmToken } = req.body;
  try {
    const existingUser = await User.findOne({ uid });
    if (!existingUser) {
      console.log("creating new user");
      const newUser = new User({
        uid,
        email,
        displayName,
        fcmToken,
      });

      await newUser.save();
      console.log("new user saved");
      return res.status(201).json({
        message: "New user created successfully.",
        user: newUser,
      });
    } else {
      existingUser.fcmToken = fcmToken;
      const uid = existingUser.uid;

      await User.updateOne(
        { uid: uid },
        {
          $set: {
            fcmToken: existingUser.fcmToken,
          },
        }
      );
      console.log("updated existingUser");
      return res.status(200).json({
        message: "Existing user updated successfully.",
        user: existingUser,
      });
    }
  } catch (error) {
    console.error("Error saving user:", error);
    res.status(500).json({
      message: "Failed to save user details.",
      error,
    });
  }
});

// API to send panic alert
let guardian =
  app.post("/panic-alert", (req, res) => {
  // const { gpsLocation, panicType, guardian } = req.body;

  const message = {
    notification: {
      title: "Panic Alert",
      body: `Hi Akash anna namaskaram, I am in danger. Please help me!`,
    },
    token: guardian, // Single FCM token for the recipient device
  };

  admin
    .messaging()
    .send(message) // Use send() for a single device
    .then((response) => {
      console.log("Successfully sent message:", response);
      res.status(200).send("Alert sent successfully.");
    })
    .catch((error) => {
      console.error("Error sending alert:", error);
      res.status(500).send("Error sending alert.");
    });
});

app.post("/update-location", async (req, res) => {
  const { uid, latitude, longitude } = req.body;
  try {
    let user = await User.findOne({ uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!user.guardians) {
      user.guardians = [];
    }

    const existingLocation = await Locations.findOne({ uid });
    if (existingLocation) {
      await Locations.updateOne(
        { uid: uid },
        {
          $set: {
            latitude: latitude,
            longitude: longitude,
            timestamp: Date.now(),
          },
        }
      );
      // Check if the notification was already sent for this location update
      if (!existingLocation.notified) {
        const message = {
          notification: {
            title: "Emergency Alert! 🚨",
            body: `Live tracking activated for ${user.displayName}. Open the app to track.`,

          },
          data: {
            type: "emergency",
            uid: uid,
            latitude: latitude.toString(),
            longitude: longitude.toString(),
            screen: "emergencyScreen",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
        };
        let gaurdiansUids = user.guardians;
        let guardiansTokens = await User.find(
          { uid: { $in: gaurdiansUids } }, // Find all users whose uid is in guardiansUids
          { fcmToken: 1, _id: 0 } // Only retrieve the fcmToken field
        );
        if (guardiansTokens.length > 0) {
          for (let token of guardiansTokens) {
            message.token = token.fcmToken;
            // console.log("Sending noti to :",token.fcmToken);
            await admin.messaging().send(message);
          }
        } else {
          console.log("No FCM tokens found for guardians");
        }

        // Mark the notification as sent{UNCOMMENT THIS IF U WANT TO SHARE NOTIFICATION ONLY ONCE}
        // await Locations.updateOne(
        //   { uid: uid },
        //   {
        //     $set: {
        //       notified: true,
        //     }
        //   }
        // );

        console.log("Notification sent and emergency record updated");
      }
      io.to(uid).emit("location-update", { latitude, longitude });
      console.log(`Sent location update to UID ${uid}: `, latitude, longitude);
      res.status(200).json({
        message: "Location updated & guardians notified",
        startTracking: !existingLocation.notified, // Send startTracking flag
      });
    } else {
      const newLocation = new Locations({
        uid,
        latitude,
        longitude,
        notified: false,
      });
      await newLocation.save();

      io.to(uid).emit("location-update", { latitude, longitude });
      console.log(`Sent location update to UID ${uid}: `, latitude, longitude);
      res.status(201).json({
        message: "Location created & guardians notified",
        startTracking: true, // Send startTracking flag
      });
    }
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ message: "Error updating location", error });
  }
});

app.post("/stop-update-location", (req, res) => {
  const { uid } = req.body;

  if (users[uid]) {
    console.log(`Stopping WebSocket connection for UID: ${uid}`);
    io.sockets.sockets.get(users[uid])?.disconnect();
    delete users[uid]; // Correct way to remove a property from an object
  }

  res.status(200).json({ message: "Tracking stopped for user" });
});

app.post("/guardian-add", async (req, res) => {
  let { userUid, guardianUid } = req.body;
  console.log(userUid, guardianUid);

  let up = await User.updateOne(
    { uid: userUid },
    { $push: { guardians: guardianUid } }
  );
  console.log(up);
  res.status(200).json({ message: "Guardian added successfully" });
});










// app.post("/update-location-police", async (req, res) => {
//   const type = "police";
//   const { uid, latitude, longitude } = req.body;

//   try {
//     let user = await User.findOne({ uid });

//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     if (!user.guardians) {
//       user.guardians = [];
//     }

//     const existingLocation = await Locations.findOne({ uid });
//     if (existingLocation) {
//       await Locations.updateOne(
//         { uid: uid },
//         {
//           $set: {
//             latitude: latitude,
//             longitude: longitude,
//             timestamp: Date.now(),
//           },
//         }
//       );

//       if (!existingLocation.notified) {
//         await sendEmergencyNotification(uid, user, latitude, longitude, type);
//       }

//       io.to(uid).emit("location-update", { latitude, longitude });
//       console.log(`Sent ${type} location update to UID ${uid}: `, latitude, longitude);

//       res.status(200).json({
//         message: `${type} location updated & notified`,
//         startTracking: !existingLocation.notified,
//       });
//     } else {
//       const newLocation = new Locations({
//         uid,
//         latitude,
//         longitude,
//         notified: false,
//       });
//       await newLocation.save();

//       io.to(uid).emit("location-update", { latitude, longitude });
//       console.log(`Sent ${type} location update to UID ${uid}: `, latitude, longitude);

//       res.status(201).json({
//         message: `${type} location created & notified`,
//         startTracking: true,
//       });
//     }
//   } catch (error) {
//     console.error(`Error updating ${type} location:`, error);
//     res.status(500).json({ message: `Error updating ${type} location`, error });
//   }
// });

// async function sendEmergencyNotification(uid, user, latitude, longitude, type) {
//   let recipientsUids = [...user.guardians];

//   // Find police/ambulance users and add their UIDs
//   let serviceUsers = await User.find({ role: type }, { uid: 1, _id: 0 });
//   recipientsUids.push(...serviceUsers.map((u) => u.uid));

//   let recipientsTokens = await User.find(
//     { uid: { $in: recipientsUids } },
//     { fcmToken: 1, _id: 0 }
//   );

//   if (recipientsTokens.length > 0) {
//     for (let token of recipientsTokens) {
//       let message = {
//         notification: {
//           title: `Emergency Alert for ${type.toUpperCase()} 🚨`,
//           body: `Live tracking activated for ${user.displayName}. Open the app to track.`,
//         },
//         data: {
//           type: type,
//           uid: uid,
//           latitude: latitude.toString(),
//           longitude: longitude.toString(),
//           screen: `${type}Screen`,
//           click_action: "FLUTTER_NOTIFICATION_CLICK",
//         },
//         token: token.fcmToken,
//       };

//       await admin.messaging().send(message);
//     }
//   } else {
//     console.log(`No FCM tokens found for ${type}`);
//   }

//   console.log(`${type.toUpperCase()} Notification sent`);
// }












app.post("/add-geofence",async (req,res)=>{
  try {
    const { uid, fencingLocations } = req.body;
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.geofence.push(...fencingLocations);
    await user.save();
    
    res.status(200).json({ message: "Geofence locations added successfully" });
  } catch (error) {
    res.status(500).json({ message: "An error occurred", error: error.message });
  }
  
})

app.get("/get-geofence/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const user = await User.findOne({ uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ geofence: user.geofence });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.post("/geofence-alert", async (req, res) => {
  const { uid, latitude, longitude } = req.body;
  const user = await User.findOne({ uid });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  if (!user.guardians) {
    user.guardians = [];
  }
  const gaurdiansUids = user.guardians;
  const message = {
    notification: {
      title: "Emergency Alert! 🚨",
      body: `We found that ${user.displayName} is outside the geofence area. Open the app to track.`,
    },
    data: {
      type: "emergency",
      uid: uid,
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      screen: "emergencyScreen",
      click_action: "FLUTTER_NOTIFICATION_CLICK",
    },
  };
  let guardiansTokens = await User.find(
    { uid: { $in: gaurdiansUids } }, // Find all users whose uid is in guardiansUids
    { fcmToken: 1, _id: 0 } // Only retrieve the fcmToken field
  );
  if (guardiansTokens.length > 0) {
    for (let token of guardiansTokens) {
      message.token = token.fcmToken;
      await admin.messaging().send(message);
    }
  } else {
    console.log("No FCM tokens found for guardians");
  }
});












app.get("/ambulance", (req, res) => {
  res.sendFile(__dirname + "/public/amb/index.html");
});
app.get("/police", (req, res) => {
  res.sendFile(__dirname + "/public/police control room/index.html");
});










const genAI = new GoogleGenerativeAI(GENAI_API_KEY);
let chatHistory = {};
let alertTriggered = false;

app.post("/suspected-abnormal", async (req, res) => {
  const { userId, bloodPressure, heartRate } = req.body;
  if (!userId || !bloodPressure || !heartRate) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const context = `You are an AI chatbot designed to assess a user's potential need for help, specifically focusing on situations involving blood pressure and heart rate. Your goal is to determine if an alert should be sent to guardians. You will interact with the user one question at a time. Remember that the user's BP and heart rate are being monitored by a smart shoe, and you should not ask for these readings directly. The smart shoe will indicate whether BP is high, low, or normal, and the same for heart rate.

  *Initial Prompt:* The user's smart shoe indicates [BP status - ${bloodPressure}] BP and [HR status - ${heartRate}] HR. Begin by asking the first question.




  *Question 1:* We found that your vitals are not normal?

1.  I'm okay.

2. Not really. I'm a bit concerned.

3. I'm feeling quite unwell.

4. I'm experiencing some alarming symptoms.

5. I was just doing some excercise/running

*(Wait for user response)*
  



*Follow-up Questions:* 
  - Ask questions based on symptoms.
  - Stop the chat if the user is safe.
  - Trigger an alert if the situation is dangerous.

  *Decision Logic:*
  - If the chatbot outputs "ALERT", send an alert.
  - If the chatbot outputs "SAFE", end the interaction.

  *Output:*
  - "ALERT: Immediate assistance required. Notifying guardians."
  - "SAFE: No issues detected. Chat session ended."
  `;

  chatHistory[userId] = []; // Start new chat session

  const botMessage = await generateGeminiResponse(context, chatHistory[userId]);

  if (botMessage.includes("ALERT")) {
    return res.json({
      message: "🚨 ALERT: Immediate assistance required. Notifying guardians.",
    });
  } else if (botMessage.includes("SAFE")) {
    return res.json({
      message: "✅ SAFE: No issues detected. Chat session ended.",
    });
  }

  chatHistory[userId].push({ role: "assistant", content: botMessage });
  try {
    let user = await User.findOne({ uid: userId });
    // console.log(user);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const message = {
      notification: {
        title: "Are you fine? 🚨",
        body: `Hey ${user.displayName}! SafeStep at your step to help you. `,
      },
      data: {
        type: "chat",
        uid: userId,
        botMessage: botMessage,
        screen: "emergencyScreen",
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
    };
    let fcm = user.fcmToken;
    message.token = fcm;
    await admin.messaging().send(message);

    console.log("Notification sent for chatting");
  } catch (e) {
    console.log("Error while notifying for chatbot:", e);
  }

  return res.json({ message: botMessage });
});


app.post("/chatbot-response", async (req, res) => {
  const { userId, userMessage } = req.body;

  if (!userId || !userMessage) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  if (!chatHistory[userId]) {
    return res.status(400).json({
      error: "No active chat session. Start with /suspected-abnormal.",
    });
  }

  chatHistory[userId].push({ role: "user", content: userMessage });

  // 🔹 Generate chatbot response
  const botMessage = await generateGeminiResponse(
    "Continue assisting the user.",
    chatHistory[userId]
  );

  // ✅ If bot detects an emergency, trigger alert
  if (botMessage.includes("ALERT")) {
    console.log("🚨 ALERT: Emergency detected! Notifying guardians...");
    return res.json({
      message: "🚨 ALERT: Immediate assistance required. Notifying guardians.",
    });
  }

  // ✅ If user is safe, stop the interaction
  if (botMessage.includes("SAFE")) {
    return res.json({
      message: "✅ SAFE: No issues detected. Chat session ended.",
    });
  }

  chatHistory[userId].push({ role: "assistant", content: botMessage });
  return res.json({ message: botMessage });
});


async function generateGeminiResponse(context, history) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    let messages = [
      { role: "user", parts: [{ text: context }] },
      ...history.map((turn) => ({
        role: turn.role,
        parts: [{ text: turn.content }],
      })),
      {
        role: "assistant",
        parts: [
          {
            text: "Ask ONE relevant question or provide multiple-choice options.",
          },
        ],
      },
    ];

    const response = await model.generateContent({ contents: messages });

    let botMessage =
      response?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I'm having trouble responding. Please try again.";

    return botMessage.trim();
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "I'm having trouble responding. Please try again.";
  }
}



















server.listen(3000, () => console.log("Server running on port 3000"));
