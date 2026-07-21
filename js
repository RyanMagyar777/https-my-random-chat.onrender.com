const socket = io();

const menu = document.getElementById("menu");
const chatApp = document.getElementById("chatApp");

const videoModeBtn = document.getElementById("videoModeBtn");
const textModeBtn = document.getElementById("textModeBtn");
const modeBadge = document.getElementById("modeBadge");
const statusEl = document.getElementById("status");

const onlineCount = document.getElementById("onlineCount");
const searchingCount = document.getElementById("searchingCount");
const chattingCount = document.getElementById("chattingCount");

const videoArea = document.getElementById("videoArea");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");

const nextBtn = document.getElementById("nextBtn");
const leaveBtn = document.getElementById("leaveBtn");

let mode = null;
let localStream = null;
let peerConnection = null;
let partnerId = null;
let currentMode = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function addMessage(name, text, isSystem = false) {
  const div = document.createElement("div");
  div.className = isSystem ? "msg system" : "msg";
  div.innerHTML = `<span class="name">${name}:</span> <span>${escapeHtml(text)}</span>`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function startApp(selectedMode) {
  mode = selectedMode;
  currentMode = selectedMode;

  menu.classList.add("hidden");
  chatApp.classList.remove("hidden");

  if (mode === "video") {
    modeBadge.textContent = "Video + Text";
    videoArea.classList.remove("hidden");

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localVideo.srcObject = localStream;
    } catch (error) {
      console.error(error);
      addMessage("System", "Camera/microphone permission is required for video mode.", true);
      setStatus("Camera/microphone permission was denied.");
      return;
    }
  } else {
    modeBadge.textContent = "Just Text";
    videoArea.classList.add("hidden");
    localStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }

  chatLog.innerHTML = "";
  messageInput.value = "";
  setStatus("Searching for someone...");
  socket.emit("join", { mode });
}

function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && partnerId) {
      socket.emit("signal", {
        to: partnerId,
        data: { candidate: event.candidate }
      });
    }
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === "failed" || state === "disconnected" || state === "closed") {
      cleanupPeer(false);
      if (currentMode === "video") {
        setStatus("Connection ended. Searching again...");
      }
    }
  };
}

async function startOffer() {
  createPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("signal", {
    to: partnerId,
    data: { sdp: peerConnection.localDescription }
  });
}

async function handleSignal(data) {
  if (!peerConnection) createPeerConnection();

  if (data.sdp) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));

    if (data.sdp.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      socket.emit("signal", {
        to: partnerId,
        data: { sdp: peerConnection.localDescription }
      });
    }
  } else if (data.candidate) {
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  }
}

function cleanupPeer(keepLocal = true) {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  remoteVideo.srcObject = null;
  partnerId = null;

  if (!keepLocal) {
    localVideo.srcObject = null;
  }
}

function fullLeave() {
  cleanupPeer(false);
  socket.emit("leave");
  chatApp.classList.add("hidden");
  menu.classList.remove("hidden");
  messageInput.value = "";
  chatLog.innerHTML = "";

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
}

videoModeBtn.addEventListener("click", () => startApp("video"));
textModeBtn.addEventListener("click", () => startApp("text"));

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  socket.emit("text-message", { text });
  messageInput.value = "";
});

nextBtn.addEventListener("click", () => {
  cleanupPeer(true);
  socket.emit("next");
  setStatus("Searching for the next person...");
});

leaveBtn.addEventListener("click", fullLeave);

socket.on("stats", (stats) => {
  onlineCount.textContent = stats.online;
  searchingCount.textContent =
    (stats.searchingVideo || 0) + (stats.searchingText || 0);
  chattingCount.textContent = stats.chatting || 0;
});

socket.on("searching", ({ mode }) => {
  setStatus(
    mode === "video"
      ? "Looking for a video chat partner..."
      : "Looking for a text chat partner..."
  );
});

socket.on("matched", async ({ partnerId: id, mode, initiator }) => {
  partnerId = ID;
  currentMode = mode;

  setStatus("Connected. Be nice.");
  addMessage("System", "Connected to a random person.", true);

  if (mode === "video") {
    createPeerConnection();
    if (initiator) {
      await startOffer();
    }
  }
});

socket.on("signal", async ({ from, data }) => {
  partnerId = from;
  if (currentMode === "video") {
    await handleSignal(data);
  }
});

socket.on("chat-message", ({ from, text }) => {
  addMessage(from, text, false);
});

socket.on("system", ({ message }) => {
  addMessage("System", message, true);
});

socket.on("partner-left", () => {
  addMessage("System", "The other person left.", true);
  cleanupPeer(true);
  setStatus("Searching again...");
  socket.emit("join", { mode: currentMode });
});

window.addEventListener("beforeunload", () => {
  socket.emit("leave");
});
