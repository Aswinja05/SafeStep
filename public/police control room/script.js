console.log("Script loaded");
let socket = null;

const emergencyData = {
    name: "Aswin",
    age: 20,
    contact: "+91-9902227821",
    guardian: "Akash P Gowda(+91-7892525214)",
    location: "Chennai, Tamil Nadu",
    latitude: 13.009009, // 🔥 Replace with real latitude
    longitude: 77.669077, // 🔥 Replace with real longitude
};

const userUID = "POio7ortW1REWBFLTzRbpie25q32"; // Replace with actual UID

// Function to connect WebSocket
function connectSocket() {
    if (!socket) {
        socket = io("http://localhost:3000");

        socket.on("connect", () => {
            console.log("✅ Connected to WebSocket server");
            socket.emit("track-user", userUID);
        });

        socket.on("location-update", ({ latitude, longitude }) => {
            console.log(`📍 Location update received: Latitude ${latitude}, Longitude ${longitude}`);
            updateEmergencyDetails(latitude, longitude);
        });

        socket.on("disconnect", () => {
            console.log("❌ Disconnected from WebSocket server");
            socket = null; // Reset socket instance
        });
    }
}

function updateEmergencyDetails(latitude, longitude) {
  const userId = userUID; // Unique identifier for the emergency user
  let existingCard = document.querySelector(`#DisplayCard[data-userid="${userId}"]`);

  if (!existingCard) {
    // If no existing card, create a new one
    existingCard = document.createElement("div");
    existingCard.id = "DisplayCard";
    existingCard.setAttribute("data-userid", userId); // Assign unique ID to the card
    existingCard.innerHTML = `
      <h2>🚨 Emergency Alert - <span class="critical">Serious</span></h2>
      <div class="field"><span>Name:</span> ${emergencyData.name}</div>
      <div class="field"><span>Age:</span> ${emergencyData.age}</div>
      <div class="field"><span>Contact:</span> ${emergencyData.contact}</div>
      <div class="field"><span>Guardian Contact:</span> ${emergencyData.guardian}</div>
      <div class="field location-field">
        <span>Location:</span> Updating...
      </div>
      <div class="map-container">
        <iframe
          width="600"
          height="450"
          style="border: 0"
          allowfullscreen=""
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
        ></iframe>
      </div>
      <div class="action">
        Dispatch team immediately to the location and notify guardians.
      </div>
    `;
    
    // Append to the container
    document.querySelector(".container").appendChild(existingCard);
  }

  // Update location details in the existing card
  const locationField = existingCard.querySelector(".location-field span:last-child");
  // if (locationField) {
  //   locationField.textContent = `Lat: ${latitude}, Lng: ${longitude}`;
  // }

  // Update Google Maps iframe
  const mapIframe = existingCard.querySelector(".map-container iframe");
  if (mapIframe) {
    const newSrc = `https://www.google.com/maps/embed?pb=!1m14!1m12!1m3!1d31099.346920741846!2d${longitude}!3d${latitude}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1sen!2sin`;
    mapIframe.src = newSrc;
  }
}


// Function to start tracking
async function startTracking() {
    try {
        const response = await fetch("http://localhost:3000/update-location", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid: userUID }),
        });

        const data = await response.json();
        console.log("Server Response:", data);

        if (response.ok && data.startTracking) {
            console.log("✅ Tracking started, calling connectSocket()");
            connectSocket();
        } else {
            console.warn("⚠️ Server did not trigger tracking.");
        }
    } catch (error) {
        console.error("❌ Error in startTracking():", error);
    }
}

// Function to stop tracking
async function stopTracking() {
    const response = await fetch("http://localhost:3000/stop-update-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: userUID }),
    });

    if (response.ok) {
        console.log("✅ Tracking stopped");
        disconnectSocket();
    } else {
        console.error("❌ Failed to stop tracking");
    }
}

// Automatically start tracking when the page loads
window.onload = connectSocket;
